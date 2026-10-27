"""French adapter: Lexique 3.83 lemma frequencies, glossed from kaikki.org's Wiktionary extracts
(French glosses from fr.wiktionary, English glosses from en.wiktionary's French entries).

    .venv/bin/python -I fr.py

The first run parses both extracts (a few minutes) into data/fr/kaikki_{en,fr}.json; later runs
reuse that cache. Writes data/fr/lemmas.jsonl, filter_stages.json, dropped.json, band_samples.txt.
"""

import csv
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common.paths import DOWNLOADS, lang_dir  # noqa: E402
from common.words import Stages, assign_ranks, dump_band_samples, standard_drops, write_lemmas  # noqa: E402

MAX_GLOSSES = 3
EXTRACTS = {
    "en": DOWNLOADS / "kaikki-en-fr" / "French.jsonl.gz",
    "fr": DOWNLOADS / "kaikki-fr-fr" / "Francais.jsonl.gz",
}
# Lexique cgram → (our POS name, Wiktionary POS codes that match it).
CGRAM = {
    "NOM": ("noun", {"noun"}),
    "VER": ("verb", {"verb"}),
    "AUX": ("verb", {"verb"}),
    "ADJ": ("adj", {"adj"}),
    "ADV": ("adv", {"adv"}),
    "ONO": ("intj", {"intj"}),
    "PRE": ("prep", {"prep"}),
    "CON": ("conj", {"conj"}),
    "ART": ("det", {"article", "det"}),
    "PRO": ("pron", {"pron"}),
}
LOW_PRIORITY = {"obsolete", "archaic", "dated", "rare", "historical", "regional", "dialectal"}
ABBREV_TAGS = {"abbreviation", "acronym", "initialism", "clipping"}
ABBREV_POS = {"abbrev", "symbol"}
NAME_POS = {"name", "proper-noun"}


def cgram_info(cgram: str) -> tuple[str, set[str]]:
    base = cgram.split(":")[0]
    if base == "ADJ" and ":" in cgram:  # ADJ:num, ADJ:pos, ADJ:dem… are determiners or numerals
        return "det", {"det", "adj", "num"}
    return CGRAM.get(base, ("other", set()))


def read_lexique() -> dict[str, dict]:
    """One entry per lemma string; score = Σ over its cgrams of mean(freqlemfilms2, freqlemlivres)."""
    lemmas: dict[str, dict] = {}
    seen = set()
    with (DOWNLOADS / "lexique" / "Lexique383.tsv").open(encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            key = (r["lemme"], r["cgram"])
            if key in seen:
                continue
            seen.add(key)
            freq = (float(r["freqlemfilms2"]) + float(r["freqlemlivres"])) / 2
            e = lemmas.setdefault(r["lemme"], {"lemma": r["lemme"], "score": 0.0, "cgram": defaultdict(float)})
            e["score"] += freq
            e["cgram"][r["cgram"]] += freq
    return lemmas


def sense_text(sense: dict) -> str:
    gl = sense.get("glosses") or []
    return gl[-1].strip() if gl else ""


def parse_extract(lang: str, wanted: set[str]) -> dict[str, list[dict]]:
    """word → [{pos, glosses (non-form-of, in sense order, low-priority senses last), abbrev}]."""
    cache = lang_dir("fr") / f"kaikki_{lang}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    out: dict[str, list[dict]] = defaultdict(list)
    with gzip.open(EXTRACTS[lang], "rt", encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            word = d.get("word")
            if word not in wanted or d.get("lang_code") != "fr":
                continue
            main, late, abbrev_senses, n = [], [], 0, 0
            for s in d.get("senses", []):
                tags = set(s.get("tags") or [])
                if s.get("form_of") or s.get("alt_of") or "form-of" in tags or "alt-of" in tags:
                    continue
                text = sense_text(s)
                if not text:
                    continue
                n += 1
                abbrev_senses += bool(tags & ABBREV_TAGS)
                (late if tags & LOW_PRIORITY else main).append(text)
            glosses = list(dict.fromkeys(main + late))
            if not glosses:
                continue
            out[word].append({
                "pos": d.get("pos", ""),
                "glosses": glosses[:6],
                "abbrev": d.get("pos") in ABBREV_POS or abbrev_senses == n,
            })
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def pick_glosses(entries: list[dict], pos_order: list[set[str]]) -> list[str]:
    """Entries whose POS matches the lemma's Lexique categories, main category first; first gloss
    of each matching entry, then fill from the main one. Proper-noun entries never count."""
    common = [e for e in entries if e["pos"] not in NAME_POS]
    ranked = []
    for codes in pos_order:
        ranked += [e for e in common if e["pos"] in codes and e not in ranked]
    if not ranked:
        return []
    glosses = list(dict.fromkeys(e["glosses"][0] for e in ranked))[:MAX_GLOSSES]
    for g in ranked[0]["glosses"][1:]:
        if len(glosses) >= MAX_GLOSSES:
            break
        if g not in glosses:
            glosses.append(g)
    return glosses


def main() -> None:
    lemmas = read_lexique()
    print(f"[fr] Lexique 3.83 lemma strings                      {len(lemmas):>8,}")
    wanted = set(lemmas)
    dicts = {lang: parse_extract(lang, wanted) for lang in ("en", "fr")}
    rows = []
    for e in lemmas.values():
        cg = sorted(e["cgram"].items(), key=lambda kv: -kv[1])
        infos = [cgram_info(c) for c, _ in cg]
        pos = ",".join(dict.fromkeys(name for name, _ in infos))
        pos_order = [codes for _, codes in infos]
        entries = {lang: dicts[lang].get(e["lemma"], []) for lang in ("en", "fr")}
        everything = entries["en"] + entries["fr"]
        commons = [x for x in everything if x["pos"] not in NAME_POS]
        rows.append({
            "lemma": e["lemma"],
            "score": e["score"],
            "pos": pos,
            "glosses": {lang: pick_glosses(entries[lang], pos_order) for lang in ("en", "fr")},
            "in_wiktionary": bool(everything),
            "proper": bool(everything) and not commons,
            "abbrev": bool(commons) and all(x["abbrev"] for x in commons),
        })
    st = Stages("fr", rows, "Lexique lemmas")
    st.keep("drop zero-frequency lemmas", lambda r: r["score"] > 0)
    st.keep("drop multiword or non-letter lemmas", lambda r: all(ch.isalpha() or ch in "'-" for ch in r["lemma"]))
    st.keep("drop lemmas not in either Wiktionary", lambda r: r["in_wiktionary"])
    st.keep("drop proper-noun-only lemmas", lambda r: not r["proper"])
    st.keep("drop lemmas without fr and en glosses", lambda r: r["glosses"]["en"] and r["glosses"]["fr"])
    standard_drops(st, "fr")
    st.write_report()
    ranked = assign_ranks(st.rows)
    write_lemmas("fr", ranked)
    dump_band_samples("fr", ranked)


if __name__ == "__main__":
    main()
