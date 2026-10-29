"""Enrichment through the Message Batches API: Haiku writes every entry for both languages, then
Sonnet reviews and repairs every English word in bands 0-8 (the polysemous head, where Haiku's
harmful errors cluster).

    .venv/bin/python -I enrich.py estimate <lang> <stage>
    .venv/bin/python -I enrich.py submit   <lang> <stage> [--confirm]
    .venv/bin/python -I enrich.py collect  <lang> <stage> [--wait]
    .venv/bin/python -I enrich.py report   <lang> <stage>
    .venv/bin/python -I enrich.py bands    en [--pilot]

Stages:
  pilot               Haiku on ~300 words spread over every band
  pilot-repair        Sonnet review-and-repair of the pilot words in EN bands 0-8
  pilot-repair-check  Sonnet re-checks the words pilot-repair changed
  haiku               Haiku on every lemma
  repair              Sonnet review-and-repair of every EN word in bands 0-8
  repair-check        Sonnet re-checks the words repair changed (optional; gives the after rate)
  games-pilot         Haiku writes practice-game content for the teachable pilot words
  games               Haiku writes practice-game content for every teachable word

Repair flags only harmful problems: a distractor that is a real sense of the word, a wrong or
minor-sense definition, a factual error, or an ungrammatical or wrong-sense example. It rewrites
just the flagged fields. `bands` writes the per-band harmful rate before and after repair to
data/en/bands.json.

The games stages run on the final entries (haiku, plus repair and repair-check for English), so
synonyms, antonyms, cloze and usage sentences fit the definition the app shows. Only teachable
words (tier >= 1, see tier()) get games.

submit only sends words of the stage that have no result yet and are not in flight, so running it
again after collect retries failures (in chunks of 10 instead of 50).
"""

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import anthropic  # noqa: E402

from common import batch, prompts  # noqa: E402
from common.paths import lang_dir  # noqa: E402
from common.words import BAND_SIZE, read_lemmas  # noqa: E402

HAIKU = "claude-haiku-5-5"
SONNET = "claude-sonnet-5-5"
STAGES = {
    # stage: (kind, model, effort)
    "pilot": ("gen", HAIKU, "low"),
    "pilot-repair": ("repair", SONNET, "medium"),
    "pilot-repair-check": ("repair", SONNET, "medium"),
    "haiku": ("gen", HAIKU, "low"),
    "repair": ("repair", SONNET, "medium"),
    "repair-check": ("repair", SONNET, "medium"),
    "games-pilot": ("games", HAIKU, "high"),
    "games": ("games", HAIKU, "high"),
}
# For each repair stage: (stage whose entries it checks, repair stage whose fixes it applies first).
REPAIR_SOURCES = {
    "pilot-repair": ("pilot", None),
    "pilot-repair-check": ("pilot", "pilot-repair"),
    "repair": ("haiku", None),
    "repair-check": ("haiku", "repair"),
}
CHUNK, RETRY_CHUNK, GAMES_CHUNK = 50, 10, 8
PILOT_SIZE = 300
REPAIR_MAX_BAND = 8  # ranks 1-22,500
USEFULNESS_CUTOFF = 2
BLOCKING_FLAGS = {"offensive", "archaic"}
SPECIALIST_FLAGS = {"technical", "jargon"}
SEED = 20261026


def eligible(usefulness: int, flags: list[str]) -> bool:
    return usefulness >= USEFULNESS_CUTOFF and not (set(flags) & BLOCKING_FLAGS)


def tier(usefulness: int, flags: list[str], is_eligible: bool) -> int:
    """Which learners see the word: beginners tier 3, intermediate 2-3, fluent and native 1-3.
    0 is never taught (ineligible, or a rare word that is also technical or jargon)."""
    if not is_eligible:
        return 0
    if usefulness >= 4:
        return 3
    if usefulness == 3:
        return 2
    if usefulness == 2 and not set(flags) & SPECIALIST_FLAGS:
        return 1
    return 0


def entry_tier(e: dict) -> int:
    return tier(e["usefulness"], e["flags"], eligible(e["usefulness"], e["flags"]))


def harmful(rep: dict) -> bool:
    return bool(rep["bad_distractors"] or rep["definition_problem"] or rep["example_problem"])


def apply_repair(gen: dict, rep: dict | None) -> dict:
    """Haiku's entry with Sonnet's fixes for the flagged fields; model becomes Sonnet's if it
    rewrote anything."""
    if rep is None or not harmful(rep):
        return gen
    out = json.loads(json.dumps(gen))
    if rep["definition_fix"]:
        out["definition"]["en"] = rep["definition_fix"]
    for bd in rep["bad_distractors"]:
        out["distractors"]["en"][bd["index"]] = bd["replacement"]
    if rep["example_fix"]:
        out["example"] = rep["example_fix"]
    out["model"] = rep["model"]
    out["repaired"] = True
    return out


def effective(rep: dict, cand: dict) -> dict:
    """The repair minus no-op fixes (a "replacement" identical to what is already there)."""
    out = {**rep, "bad_distractors": [b for b in rep["bad_distractors"]
                                      if b["replacement"] != cand["distractors"]["en"][b["index"]]]}
    for f, cur in (("definition", cand["definition"]["en"]), ("example", cand["example"])):
        if out[f"{f}_fix"] == cur:
            out[f"{f}_problem"] = out[f"{f}_fix"] = ""
    return out


def repairs(lang: str, stage: str, base: dict[int, dict] | None = None) -> dict[int, dict]:
    """rank → effective repair of the stage, against the entries it checked."""
    base = merged(lang, *REPAIR_SOURCES[stage]) if base is None else base
    return {r: effective(x, base[r]) for r, x in batch.load_results(lang, stage).items() if r in base}


def merged(lang: str, gen_stage: str, repair_stage: str | None) -> dict[int, dict]:
    """Generated entries with the fixes of repair_stage and of every repair stage before it
    (haiku → repair → repair-check)."""
    if repair_stage is None:
        return batch.load_results(lang, gen_stage)
    base = merged(lang, *REPAIR_SOURCES[repair_stage])
    rep = repairs(lang, repair_stage, base)
    return {r: apply_repair(g, rep.get(r)) for r, g in base.items()}


def final(lang: str) -> dict[int, dict]:
    """The entries the seed ships: Haiku's, with Sonnet's repairs for English."""
    return merged(lang, "haiku", "repair-check" if lang == "en" else None)


def games(lang: str) -> dict[int, dict]:
    """rank → game content; the full stage wins over the pilot for words in both."""
    return {**batch.load_results(lang, "games-pilot"), **batch.load_results(lang, "games")}


def pilot_ranks(words: list[dict]) -> list[int]:
    bands = defaultdict(list)
    for w in words:
        bands[w["band"]].append(w)
    rng = random.Random(SEED)
    per = PILOT_SIZE // len(bands)
    return sorted(w["rank"] for b in sorted(bands) for w in rng.sample(bands[b], min(per, len(bands[b]))))


def stage_ranks(lang: str, stage: str, words: list[dict], cands: dict[int, dict] | None = None) -> list[int]:
    if stage == "pilot":
        # Once run, the pilot words are the ones already done (matched by lemma), so a list
        # rebuild doesn't draw a new sample.
        done = batch.load_results(lang, "pilot")
        return sorted(done) if done else pilot_ranks(words)
    if stage == "haiku":
        return [w["rank"] for w in words]
    if STAGES[stage][0] == "games":
        ranks = stage_ranks(lang, "pilot", words) if stage == "games-pilot" else [w["rank"] for w in words]
        return [r for r in ranks if r in cands and entry_tier(cands[r]) >= 1]
    gen_stage, prior = REPAIR_SOURCES[stage]
    head = [r for r in batch.load_results(lang, gen_stage) if (r - 1) // BAND_SIZE <= REPAIR_MAX_BAND]
    if prior is None:
        return sorted(head)
    rep = repairs(lang, prior)
    return sorted(r for r in head if r in rep and harmful(rep[r]))


def build_chunks(lang: str, stage: str) -> list[tuple[str, list[int], dict]]:
    kind, model, effort = STAGES[stage]
    if kind == "repair" and lang != "en":
        sys.exit("repair runs on the English course only")
    words = read_lemmas(lang)
    by_rank = {w["rank"]: w for w in words}
    done = games(lang) if stage == "games" else batch.load_results(lang, stage)  # games: pilot words count too
    batches = batch.load_batches(lang, stage)
    in_flight = {r for b in batches if not b["collected"] for rs in b["requests"].values() for r in rs}
    tried = {r for b in batches if b["collected"] for rs in b["requests"].values() for r in rs}
    cands = (merged(lang, *REPAIR_SOURCES[stage]) if kind == "repair"
             else final(lang) if kind == "games" else None)
    pending = [r for r in stage_ranks(lang, stage, words, cands) if r not in done and r not in in_flight]
    retry = [r for r in pending if r in tried]
    fresh = [r for r in pending if r not in tried]
    system = prompts.system_prompt(lang, kind)
    schema = prompts.schema(lang, kind)
    n0 = sum(len(b["requests"]) for b in batches)
    chunks = []
    # Games run at high effort, ~3.5K output tokens a word with thinking: small requests stay under MAX_TOKENS.
    sizes = (GAMES_CHUNK, GAMES_CHUNK // 2) if kind == "games" else (CHUNK, RETRY_CHUNK)
    for ranks, size in zip((fresh, retry), sizes):
        for i in range(0, len(ranks), size):
            part = ranks[i:i + size]
            user = prompts.user_prompt(lang, [by_rank[r] for r in part], kind, cands)
            cid = f"{stage}-{n0 + len(chunks):05d}"
            chunks.append((cid, part, batch.params(model, effort, system, user, schema)))
    return chunks


def parser(lang: str, kind: str):
    def parse(e: dict, model: str) -> dict | None:
        if kind == "gen":
            # Haiku sometimes writes 4 distractors; the first 3 are as good as any 3.
            e = {**e, "distractors": {k: v[:3] for k, v in e["distractors"].items()}}
            if not prompts.valid_gen(lang, e):
                return None
            return {"rank": e["rank"], "lemma": e["lemma"], "usefulness": e["usefulness"],
                    "flags": sorted(set(e["flags"])),
                    "definition": {k: v.strip() for k, v in e["definition"].items()},
                    "distractors": {k: [d.strip() for d in v] for k, v in e["distractors"].items()},
                    "example": e["example"].strip(), "model": model}
        if kind == "games":
            lemma = e["lemma"].strip().casefold()

            def alts(xs: list[str]) -> list[str]:  # distinct, not the word itself, at most 3
                out = []
                for x in (x.strip() for x in xs):
                    if x and x.casefold() != lemma and x.casefold() not in {o.casefold() for o in out}:
                        out.append(x)
                return out[:3]
            cz, us = e["cloze"], e["usage"]
            # Like distractors: an extra bank word or wrong usage is dropped, not retried.
            row = {"rank": e["rank"], "lemma": e["lemma"],
                   "synonyms": alts(e["synonyms"]), "antonyms": alts(e["antonyms"]),
                   "cloze": {"sentence": prompts.BLANK.sub("___", cz["sentence"]).strip(),
                             "answer": cz["answer"].strip(), "bank": [b.strip() for b in cz["bank"][:3]]},
                   "usage": {"correct": us["correct"].strip(), "wrong": [s.strip() for s in us["wrong"][:3]]},
                   "model": model}
            return row if prompts.valid_games(lang, row) else None
        bad ={bd["index"]: {"index": bd["index"], "reason": bd["reason"].strip(),
                             "replacement": bd["replacement"].strip()} for bd in e["bad_distractors"]}
        row = {"rank": e["rank"], "bad_distractors": sorted(bad.values(), key=lambda b: b["index"]),
               "model": model}
        for f in ("definition", "example"):
            row[f"{f}_problem"] = e[f"{f}_problem"].strip()
            row[f"{f}_fix"] = e[f"{f}_fix"].strip() if row[f"{f}_problem"] else ""
            if row[f"{f}_problem"] and not row[f"{f}_fix"]:
                return None  # flagged without a fix: retry
        if any(not b["replacement"] for b in row["bad_distractors"]):
            return None
        return row
    return parse


def harm_table(lang: str, repair_stage: str, check_stage: str) -> list[dict]:
    """Per band: words reviewed, harmful before repair (by problem type), and harmful after (words
    the check stage still flags; words repair left alone count as clean)."""
    words = {w["rank"]: w for w in read_lemmas(lang)}
    rep = repairs(lang, repair_stage)
    chk = repairs(lang, check_stage)
    rows = defaultdict(lambda: defaultdict(int))
    for rank, r in rep.items():
        t = rows[words[rank]["band"]]
        t["reviewed"] += 1
        t["before"] += harmful(r)
        t["distractor"] += bool(r["bad_distractors"])
        t["definition"] += bool(r["definition_problem"])
        t["example"] += bool(r["example_problem"])
        t["after"] += rank in chk and harmful(chk[rank])
        t["checked"] += rank in chk
    out = []
    for b in sorted(rows):
        t = rows[b]
        out.append({"band": b, "ranks": [b * BAND_SIZE + 1, (b + 1) * BAND_SIZE], "reviewed": t["reviewed"],
                    "harmful_before": t["before"], "rate_before": round(t["before"] / t["reviewed"], 4),
                    "bad_distractor": t["distractor"], "bad_definition": t["definition"], "bad_example": t["example"],
                    "rechecked": t["checked"], "harmful_after": t["after"],
                    "rate_after": round(t["after"] / t["reviewed"], 4) if t["checked"] else None})
    return out


def print_harm(lang: str, table: list[dict]) -> None:
    print(f"\n[{lang}] band  ranks          reviewed  harmful  before  distr  def  ex  rechecked  after")
    tot = defaultdict(int)
    for t in table:
        after = f"{t['rate_after']:>5.0%}" if t["rate_after"] is not None else "    -"
        print(f"[{lang}] {t['band']:>4}  {t['ranks'][0]:>5}-{t['ranks'][1]:<7} {t['reviewed']:>8}  {t['harmful_before']:>7}  "
              f"{t['rate_before']:>5.0%}  {t['bad_distractor']:>5}  {t['bad_definition']:>3}  {t['bad_example']:>2}  "
              f"{t['rechecked']:>9}  {after}")
        for k in ("reviewed", "harmful_before", "harmful_after", "rechecked"):
            tot[k] += t[k]
    if tot["reviewed"]:
        print(f"[{lang}] all bands: harmful {tot['harmful_before']}/{tot['reviewed']} = "
              f"{tot['harmful_before'] / tot['reviewed']:.1%} before repair, "
              f"{tot['harmful_after']}/{tot['reviewed']} = {tot['harmful_after'] / tot['reviewed']:.1%} after "
              f"({tot['rechecked']} repaired words re-checked)")


def cmd_bands(lang: str, pilot: bool) -> None:
    rep, chk = ("pilot-repair", "pilot-repair-check") if pilot else ("repair", "repair-check")
    table = harm_table(lang, rep, chk)
    if not table:
        sys.exit(f"no {rep} results collected yet")
    print_harm(lang, table)
    if pilot:
        return
    out = {"lang": lang, "generation_model": HAIKU, "repair_model": SONNET,
           "repaired_bands": f"0-{REPAIR_MAX_BAND}",
           "harmful": "a distractor that is a real sense of the word; a wrong or minor-sense definition; "
                      "a factual error; an ungrammatical or wrong-sense example",
           "eligibility": f"Haiku's usefulness >= {USEFULNESS_CUTOFF} and no flag in {sorted(BLOCKING_FLAGS)}",
           "bands": table}
    path = lang_dir(lang) / "bands.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    print(f"[{lang}] wrote {path}")


def cmd_report(lang: str, stage: str) -> None:
    """Readable dump for hand review. For repair stages: each flagged word, before and after. For
    games stages: each word's definition with its synonyms, antonyms, cloze and usage sentences."""
    words = {w["rank"]: w for w in read_lemmas(lang)}
    print(f"[{lang}/{stage}] actual cost: {batch.actual_cost(lang, stage)}")
    path = lang_dir(lang) / f"{stage}_report.md"
    kind = STAGES[stage][0]
    with path.open("w", encoding="utf-8") as f:
        f.write(f"# {lang} {stage}\n\n")
        if kind == "gen":
            for rank, g in sorted(batch.load_results(lang, stage).items()):
                w = words[rank]
                f.write(f"## {rank} {w['lemma']} ({w['pos']}, band {w['band']})  usefulness {g['usefulness']} "
                        f"{g['flags'] or ''} → {'eligible' if eligible(g['usefulness'], g['flags']) else 'NOT eligible'}\n")
                for k in prompts.DEF_LANGS[lang]:
                    f.write(f"- def[{k}]: {g['definition'][k]}\n")
                    for d in g["distractors"][k]:
                        f.write(f"  - ✗ {d}\n")
                f.write(f"- example: {g['example']}\n\n")
        elif kind == "games":
            src = final(lang)
            res = batch.load_results(lang, stage)
            f.write(f"{len(res)} words.\n\n")
            for rank, g in sorted(res.items()):
                w, e = words[rank], src.get(rank)
                cz, us = g["cloze"], g["usage"]
                f.write(f"## {rank} {w['lemma']} ({w['pos']}, band {w['band']})"
                        + (f"  tier {entry_tier(e)}" if e else "") + "\n")
                if e:
                    f.write(f"- definition: {e['definition'][lang]}\n- example: {e['example']}\n")
                f.write(f"- synonyms: {', '.join(g['synonyms']) or '—'}\n")
                f.write(f"- antonyms: {', '.join(g['antonyms']) or '—'}\n")
                filled = cz["sentence"].replace("___", f"**{cz['answer']}**")
                f.write(f"- cloze: {filled}\n  - bank: {', '.join(cz['bank'])}\n")
                f.write(f"- usage:\n  - ✓ {us['correct']}\n")
                for s in us["wrong"]:
                    f.write(f"  - ✗ {s}\n")
                f.write("\n")
        else:
            before = merged(lang, *REPAIR_SOURCES[stage])
            rep = repairs(lang, stage, before)
            flagged = [r for r in sorted(rep) if harmful(rep[r])]
            f.write(f"{len(flagged)} of {len(rep)} words flagged.\n\n")
            for rank in flagged:
                g, r, w = before[rank], rep[rank], words[rank]
                a = apply_repair(g, r)
                f.write(f"## {rank} {w['lemma']} ({w['pos']}, band {w['band']})\n")
                if r["definition_problem"]:
                    f.write(f"- **definition** ({r['definition_problem']})\n  - before: {g['definition']['en']}\n"
                            f"  - after: {a['definition']['en']}\n")
                else:
                    f.write(f"- definition: {g['definition']['en']}\n")
                for bd in r["bad_distractors"]:
                    f.write(f"- **distractor {bd['index']}** ({bd['reason']})\n"
                            f"  - before: {g['distractors']['en'][bd['index']]}\n  - after: {bd['replacement']}\n")
                if r["example_problem"]:
                    f.write(f"- **example** ({r['example_problem']})\n  - before: {g['example']}\n"
                            f"  - after: {a['example']}\n")
                f.write("\n")
    print(f"[{lang}/{stage}] wrote {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["estimate", "submit", "collect", "report", "bands"])
    ap.add_argument("lang", choices=["en", "fr"])
    ap.add_argument("stage", nargs="?", choices=list(STAGES))
    ap.add_argument("--confirm", action="store_true", help="submit without the interactive prompt")
    ap.add_argument("--wait", action="store_true", help="collect: poll every minute until every batch ends")
    ap.add_argument("--pilot", action="store_true", help="bands: the pilot repair stages")
    ap.add_argument("--reparse", action="store_true",
                    help="collect: re-download failed requests of collected batches and parse them again (free)")
    a = ap.parse_args()
    if a.cmd == "bands":
        return cmd_bands(a.lang, a.pilot)
    if not a.stage:
        ap.error("stage is required")
    if a.cmd == "report":
        return cmd_report(a.lang, a.stage)
    kind, model, _ = STAGES[a.stage]
    if a.cmd == "collect" and a.reparse:
        batch.reparse_failed(anthropic.Anthropic(), a.lang, a.stage, parser(a.lang, kind))
        print(f"[{a.lang}/{a.stage}] {len(batch.load_results(a.lang, a.stage)):,} words with results")
        return
    if a.cmd == "collect":
        done = batch.collect(anthropic.Anthropic(), a.lang, a.stage, parser(a.lang, kind), a.wait)
        print(f"[{a.lang}/{a.stage}] {len(batch.load_results(a.lang, a.stage)):,} words with results; "
              f"{'all batches collected' if done else 'batches still running'}")
        print(f"[{a.lang}/{a.stage}] actual cost: {batch.actual_cost(a.lang, a.stage)}")
        return
    chunks = build_chunks(a.lang, a.stage)
    if not chunks:
        print(f"[{a.lang}/{a.stage}] nothing pending")
        return
    client = anthropic.Anthropic()
    est = batch.estimate(client, a.lang, kind, model, chunks)
    batch.print_estimate(est, a.stage, a.lang)
    if a.cmd == "submit" and batch.confirm(est, a.confirm):
        batch.submit(client, a.lang, a.stage, kind, chunks)


if __name__ == "__main__":
    main()
