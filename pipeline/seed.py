"""Merge lemmas and enrichment into D1 seed chunks and a release JSONL.

    .venv/bin/python -I seed.py <lang> [--allow-missing]

Every entry is Haiku's, with Sonnet's repair and repair-check fixes applied for English bands
0-8 (source_model is Sonnet's for any word it rewrote). games is the games stage's content
(games-pilot's where the full stage has none yet), or {} for a word without any. Writes
data/seed/<lang>-NNN.sql (upserts into `words`, see migrations/0001_init.sql and
0003_lifecycle.sql) and data/seed/<lang>-words.jsonl.gz. Load with:

    npx wrangler d1 execute vocabulary-app --remote --file pipeline/data/seed/<lang>-000.sql
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import batch, prompts  # noqa: E402
from common.paths import SEED  # noqa: E402
from common.words import ID_BASE, read_lemmas  # noqa: E402
from enrich import eligible, final, games, tier  # noqa: E402

COLUMNS = ["id", "lang", "lemma", "rank", "pos", "glosses", "definition", "distractors", "example",
           "usefulness", "flags", "eligible", "band", "source_model", "games", "tier"]
ROWS_PER_FILE = 2500
MAX_STATEMENT_BYTES = 60_000  # D1 caps one SQL statement at 100 KB


def sql_value(v) -> str:
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def build_rows(lang: str, allow_missing: bool) -> list[dict]:
    words = read_lemmas(lang)
    entries = final(lang)
    game = games(lang)
    rows, missing = [], []
    for w in words:
        e = entries.get(w["rank"])
        if e is None:
            missing.append(w["lemma"])
            continue
        elig = eligible(e["usefulness"], e["flags"])
        g = game.get(w["rank"])
        rows.append({
            "id": ID_BASE[lang] + w["rank"],
            "lang": lang,
            "lemma": w["lemma"],
            "rank": w["rank"],
            "pos": w["pos"],
            "glosses": {k: v for k, v in w["glosses"].items() if v},
            "definition": {k: e["definition"][k] for k in prompts.DEF_LANGS[lang]},
            "distractors": {k: e["distractors"][k] for k in prompts.DEF_LANGS[lang]},
            "example": e["example"],
            "usefulness": e["usefulness"],
            "flags": e["flags"],
            "eligible": int(elig),
            "band": w["band"],
            "source_model": e["model"],
            "games": {k: g[k] for k in ("synonyms", "antonyms", "cloze", "usage")} if g else {},
            "tier": tier(e["usefulness"], e["flags"], elig),
        })
    if missing:
        print(f"[{lang}] {len(missing):,} words have no enrichment, e.g. {missing[:15]}")
        if not allow_missing:
            sys.exit("collect or retry the missing words first (or pass --allow-missing to drop them)")
    return rows


def write_sql(lang: str, rows: list[dict]) -> list[Path]:
    SEED.mkdir(parents=True, exist_ok=True)
    for old in SEED.glob(f"{lang}-[0-9][0-9][0-9].sql"):
        old.unlink()
    updates = ", ".join(f"{c} = excluded.{c}" for c in COLUMNS if c != "id")
    paths = []
    for fi in range(0, len(rows), ROWS_PER_FILE):
        path = SEED / f"{lang}-{fi // ROWS_PER_FILE:03d}.sql"
        head = f"INSERT INTO words ({', '.join(COLUMNS)}) VALUES\n"
        tail = f"\nON CONFLICT(id) DO UPDATE SET {updates};\n"
        with path.open("w", encoding="utf-8") as f:
            values, size = [], 0
            for r in rows[fi:fi + ROWS_PER_FILE]:
                vals = [json.dumps(r[c], ensure_ascii=False) if isinstance(r[c], (dict, list)) else r[c]
                        for c in COLUMNS]
                v = "(" + ", ".join(sql_value(x) for x in vals) + ")"
                n = len(v.encode()) + 2
                if values and size + n > MAX_STATEMENT_BYTES - len(head) - len(tail):
                    f.write(head + ",\n".join(values) + tail)
                    values, size = [], 0
                values.append(v)
                size += n
            if values:
                f.write(head + ",\n".join(values) + tail)
        paths.append(path)
    return paths


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("lang", choices=["en", "fr"])
    ap.add_argument("--allow-missing", action="store_true")
    a = ap.parse_args()
    rows = build_rows(a.lang, a.allow_missing)
    paths = write_sql(a.lang, rows)
    out = SEED / f"{a.lang}-words.jsonl.gz"
    with gzip.open(out, "wt", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    n_elig = sum(r["eligible"] for r in rows)
    tiers = {t: sum(r["tier"] == t for r in rows) for t in (3, 2, 1, 0)}
    teach = [r for r in rows if r["tier"]]
    n_games = sum(bool(r["games"]) for r in teach)
    models = {}
    for r in rows:
        models[r["source_model"]] = models.get(r["source_model"], 0) + 1
    print(f"[{a.lang}] {len(rows):,} rows ({n_elig:,} eligible), by model {models}")
    print(f"[{a.lang}] tiers {tiers}; games for {n_games:,} of {len(teach):,} teachable words")
    print(f"[{a.lang}] wrote {len(paths)} SQL chunks ({paths[0].name} … {paths[-1].name}) and {out}")


if __name__ == "__main__":
    main()
