"""Games content written by Claude Code subagents in a cloud session, instead of the Batch API.

    .venv/bin/python -I cloud_games.py export <lang>               # local: input + prompt into cloud/
    python3 cloud_games.py todo   <lang> --limit N [--chunk 20]    # cloud: next chunks to write
    python3 cloud_games.py check  <lang> [--limit N]               # cloud: progress + review report
    .venv/bin/python -I cloud_games.py import <lang>               # local: valid results into the games stage

cloud/<lang>-input.jsonl holds every teachable word with no games result yet, core words first
(tier 3, then 2, then 1, each by rank), as the same JSON the batch stage sends. cloud/<lang>-prompt.md
is the batch system prompt plus the output format. A subagent reads one cloud/todo/<lang>-*.jsonl
chunk and writes one JSON object per word to cloud/out/<lang>/<same name>.jsonl.

check and import validate every output line with the batch parser (enrich.parser), so the rules
are the same as for batch results; import appends to data/<lang>/enrich/games/results.jsonl, which
the seed reads. cloud/ is committed only on the working branch that carries it to the cloud.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import prompts  # noqa: E402

CLOUD = Path(__file__).resolve().parent / "cloud"
OUTPUT_FORMAT = """

## Output

Write one JSON object per word, one per line (JSONL), in the same order as the input, with exactly
these keys: rank and lemma (copied from the input), synonyms (array of strings), antonyms (array of
strings), cloze (object: sentence with ___ exactly once, answer, bank: array of exactly 3 strings),
usage (object: correct: string, wrong: array of exactly 3 strings). No other text in the file.

Take your time on each word. Before keeping a wrong usage sentence, read it as a fluent speaker would
and check it is wrong in EVERY sense of the word, not only the defined one. Before keeping a bank
word, put it in the blank and check the sentence is then false or absurd."""


def input_path(lang: str) -> Path:
    return CLOUD / f"{lang}-input.jsonl"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()] if path.exists() else []


def cmd_export(lang: str) -> None:
    import enrich
    from common.words import read_lemmas

    words = read_lemmas(lang)
    src = enrich.final(lang)
    done = enrich.games(lang)
    ranks = [r for r in enrich.stage_ranks(lang, "games", words, src) if r not in done]
    by_rank = {w["rank"]: w for w in words}
    rows = [{**prompts.word_input(lang, by_rank[r], src[r], "games"), "tier": enrich.entry_tier(src[r])} for r in ranks]
    rows.sort(key=lambda x: (-x["tier"], x["rank"]))
    CLOUD.mkdir(exist_ok=True)
    with input_path(lang).open("w", encoding="utf-8") as f:
        for x in rows:
            f.write(json.dumps(x, ensure_ascii=False) + "\n")
    (CLOUD / f"{lang}-prompt.md").write_text(prompts.system_prompt(lang, "games") + OUTPUT_FORMAT + "\n")
    tiers = {t: sum(x["tier"] == t for x in rows) for t in (3, 2, 1)}
    print(f"[{lang}] wrote {len(rows):,} words to {input_path(lang)} (tier 3/2/1: {tiers[3]:,}/{tiers[2]:,}/{tiers[1]:,}); "
          f"{len(done):,} already have games")


def valid_outputs(lang: str) -> dict[str, dict]:
    """lemma → parsed result, from every output file; a later valid line wins."""
    from enrich import parser
    parse = parser(lang, "games")
    out = {}
    for path in sorted((CLOUD / "out" / lang).glob("*.jsonl")):
        for line in path.open(encoding="utf-8"):
            try:
                row = parse(json.loads(line), "cloud")
            except (json.JSONDecodeError, KeyError, TypeError, AttributeError):
                row = None
            if row:
                out[row["lemma"]] = row
    return out


def cmd_todo(lang: str, limit: int, chunk: int) -> None:
    words = read_jsonl(input_path(lang))[:limit]
    done = valid_outputs(lang)
    pending = [w for w in words if w["lemma"] not in done]
    todo = CLOUD / "todo"
    todo.mkdir(exist_ok=True)
    for old in todo.glob(f"{lang}-*.jsonl"):
        old.unlink()
    # Chunk names never repeat, so a retry's output file doesn't overwrite an earlier one.
    out_dir = CLOUD / "out" / lang
    run = 1 + max((int(p.stem.split("-")[1][1:]) for p in out_dir.glob(f"{lang}-r*.jsonl")), default=0)
    for i in range(0, len(pending), chunk):
        with (todo / f"{lang}-r{run}-{i // chunk:04d}.jsonl").open("w", encoding="utf-8") as f:
            for w in pending[i:i + chunk]:
                f.write(json.dumps({k: v for k, v in w.items() if k != "tier"}, ensure_ascii=False) + "\n")
    n = -(-len(pending) // chunk)
    print(f"[{lang}] {len(words) - len(pending):,}/{len(words):,} done; {len(pending):,} pending in {n} chunks under {todo}")


def cmd_check(lang: str, limit: int | None) -> None:
    words = read_jsonl(input_path(lang))
    if limit:
        words = words[:limit]
    done = valid_outputs(lang)
    ok = [w for w in words if w["lemma"] in done]
    print(f"[{lang}] {len(ok):,}/{len(words):,} words have valid games")
    path = CLOUD / f"{lang}-report.md"
    with path.open("w", encoding="utf-8") as f:
        f.write(f"# {lang} cloud games\n\n{len(ok):,} of {len(words):,} words.\n\n")
        for w in ok:
            g = done[w["lemma"]]
            cz, us = g["cloze"], g["usage"]
            f.write(f"## {w['rank']} {w['lemma']} ({w['pos']})  tier {w['tier']}\n"
                    f"- definition: {w['definition']}\n"
                    f"- synonyms: {', '.join(g['synonyms']) or '—'}\n- antonyms: {', '.join(g['antonyms']) or '—'}\n"
                    f"- cloze: {cz['sentence'].replace('___', '**' + cz['answer'] + '**')}\n"
                    f"  - bank: {', '.join(cz['bank'])}\n- usage:\n  - ✓ {us['correct']}\n")
            f.writelines(f"  - ✗ {s}\n" for s in us["wrong"])
            f.write("\n")
    print(f"[{lang}] wrote {path}")


def cmd_import(lang: str) -> None:
    from common import batch
    from common.words import read_lemmas

    known = {w["lemma"] for w in read_lemmas(lang)}
    have = {r["lemma"] for r in batch.load_results(lang, "games").values()}
    rows = [r for lemma, r in valid_outputs(lang).items() if lemma in known and lemma not in have]
    batch.append_jsonl(batch.stage_dir(lang, "games") / "results.jsonl", rows)
    print(f"[{lang}] imported {len(rows):,} words into the games stage ({len(have):,} were already there)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["export", "todo", "check", "import"])
    ap.add_argument("lang", choices=["en", "fr"])
    ap.add_argument("--limit", type=int, help="only the first N input words (todo: required)")
    ap.add_argument("--chunk", type=int, default=20, help="words per todo chunk")
    a = ap.parse_args()
    if a.cmd == "export":
        cmd_export(a.lang)
    elif a.cmd == "todo":
        if not a.limit:
            ap.error("todo needs --limit")
        cmd_todo(a.lang, a.limit, a.chunk)
    elif a.cmd == "check":
        cmd_check(a.lang, a.limit)
    else:
        cmd_import(a.lang)


if __name__ == "__main__":
    main()
