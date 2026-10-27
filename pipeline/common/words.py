"""Shared filter stages, band logic and lemma-file I/O for the per-language adapters."""

import json
import random
import re
from collections import defaultdict
from pathlib import Path

from .paths import DOWNLOADS, lang_dir

BAND_SIZE = 2500
MIN_LETTERS = 3
# Word ids are a per-language base plus rank (see migrations/0001_init.sql).
ID_BASE = {"en": 1_000_000, "fr": 2_000_000}


def band_of(rank: int) -> int:
    return (rank - 1) // BAND_SIZE


def letter_count(lemma: str) -> int:
    return sum(ch.isalpha() for ch in lemma)


def load_ldnoobw(lang: str) -> set[str]:
    path = DOWNLOADS / "ldnoobw" / lang
    return {line.strip().lower() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


class Stages:
    """Applies named filters in order and prints the row count after each one."""

    def __init__(self, lang: str, rows: list[dict], label: str):
        self.lang = lang
        self.rows = rows
        self.log: list[dict] = [{"stage": label, "rows": len(rows), "dropped": 0}]
        self.dropped: dict[str, list[str]] = {}
        print(f"[{lang}] {label:<44} {len(rows):>8,}")

    def keep(self, label: str, pred) -> None:
        kept, gone = [], []
        for r in self.rows:
            (kept if pred(r) else gone).append(r)
        self.rows = kept
        self.dropped[label] = [r["lemma"] for r in gone]
        self.log.append({"stage": label, "rows": len(kept), "dropped": len(gone)})
        print(f"[{self.lang}] {label:<44} {len(kept):>8,}  (-{len(gone):,})")

    def write_report(self) -> None:
        out = lang_dir(self.lang)
        (out / "filter_stages.json").write_text(json.dumps(self.log, indent=2) + "\n")
        (out / "dropped.json").write_text(json.dumps(self.dropped, ensure_ascii=False, indent=1) + "\n")


def standard_drops(st: Stages, lang: str) -> None:
    """The drop rules both languages share: length, abbreviations, LDNOOBW profanity."""
    bad = load_ldnoobw(lang)
    st.keep(f"drop < {MIN_LETTERS} letters", lambda r: letter_count(r["lemma"]) >= MIN_LETTERS)
    st.keep("drop abbreviations", lambda r: not r.get("abbrev"))
    st.keep("drop LDNOOBW profanity", lambda r: r["lemma"].lower() not in bad)


def assign_ranks(rows: list[dict]) -> list[dict]:
    rows.sort(key=lambda r: (-r["score"], r["lemma"]))
    out = []
    for i, r in enumerate(rows, start=1):
        out.append({
            "lemma": r["lemma"],
            "rank": i,
            "band": band_of(i),
            "pos": r["pos"],
            "score": round(r["score"], 4),
            "glosses": r["glosses"],
            **({"zipf": round(r["zipf"], 2)} if "zipf" in r else {}),
            **({"also_proper": True} if r.get("also_proper") else {}),
            **({"all_glosses": r["all_glosses"]} if r.get("all_glosses") else {}),
        })
    return out


def write_lemmas(lang: str, rows: list[dict]) -> Path:
    path = lang_dir(lang) / "lemmas.jsonl"
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"[{lang}] wrote {len(rows):,} lemmas to {path}")
    return path


def read_lemmas(lang: str) -> list[dict]:
    path = lang_dir(lang) / "lemmas.jsonl"
    return [json.loads(line) for line in path.open(encoding="utf-8")]


def dump_band_samples(lang: str, rows: list[dict], per_band: int = 50, seed: int = 7,
                      path: Path | None = None, quiet: bool = False) -> Path:
    """50 random words per 2,500-rank band, for hand review."""
    rng = random.Random(seed)
    by_band = defaultdict(list)
    for r in rows:
        by_band[r["band"]].append(r)
    path = path or lang_dir(lang) / "band_samples.txt"
    with path.open("w", encoding="utf-8") as f:
        for band in sorted(by_band):
            items = by_band[band]
            pick = sorted(rng.sample(items, min(per_band, len(items))), key=lambda r: r["rank"])
            f.write(f"=== band {band}: ranks {band * BAND_SIZE + 1}-{band * BAND_SIZE + len(items)} ===\n")
            for r in pick:
                gl = next((g for k in ("en", "fr") for g in r["glosses"].get(k, [])[:1]), "")
                z = f"{r['zipf']:>5.2f} " if "zipf" in r else ""
                f.write(f"{r['rank']:>6}  {z}{r['lemma']:<22} {r['pos']:<12} {gl[:90]}\n")
            f.write("\n")
    if not quiet:
        print(f"[{lang}] wrote band samples to {path}")
    return path


VOWELS = re.compile(r"[aeiouyàâäéèêëîïôöùûüÿæœ]", re.I)


def has_vowel(word: str) -> bool:
    return bool(VOWELS.search(word))
