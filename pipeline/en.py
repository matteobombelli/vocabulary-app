"""English adapter: vocabulary = Open English WordNet lemmas ∪ en.wiktionary English lemmas, ranked
by wordfreq, glossed from OEWN (or Wiktionary for lemmas OEWN lacks).

    .venv/bin/python -I en.py                 # build with the chosen Zipf floor
    .venv/bin/python -I en.py --compare       # list size and tail samples at several floors

The first run parses the kaikki extract (a few minutes) into data/en/kaikki_en.json. Writes
data/en/lemmas.jsonl, filter_stages.json, dropped.json, band_samples.txt (and floors/ with
--compare).
"""

import argparse
import gzip
import json
import math
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common.paths import DOWNLOADS, lang_dir  # noqa: E402
from common.words import (BAND_SIZE, Stages, assign_ranks, dump_band_samples, has_vowel,  # noqa: E402
                          standard_drops, write_lemmas)

os.environ.setdefault("WN_DATA_DIR", str(DOWNLOADS / "wn"))
import wn  # noqa: E402
import wordfreq  # noqa: E402
from wn.morphy import Morphy  # noqa: E402

# Lemmas whose summed wordfreq frequency is below this Zipf value are cut (see README).
ZIPF_FLOOR = 1.25
COMPARE_FLOORS = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5]
MAX_GLOSSES = 3
MAX_ALL_GLOSSES = 12  # every sense, for the Sonnet repair check (not seeded)
OEWN_POS = {"n": "noun", "v": "verb", "a": "adj", "s": "adj", "r": "adv"}
# Wiktionary POS codes that make a lemma, mapped to our POS names. Names, abbreviations, symbols,
# affixes, phrases and contractions are left out.
WIKT_POS = {"noun": "noun", "verb": "verb", "adj": "adj", "adv": "adv", "intj": "intj", "prep": "prep",
            "postp": "prep", "conj": "conj", "pron": "pron", "det": "det", "article": "det",
            "num": "num", "particle": "particle"}
NOT_A_SENSE = {"form-of", "alt-of", "misspelling", "abbreviation", "initialism", "acronym"}
LOW = {"obsolete", "archaic", "rare", "dated", "nonstandard"}
ABBREV = re.compile(r"\babbreviation\b", re.I)
ROMAN = re.compile(r"^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")
EXTRACT = DOWNLOADS / "kaikki-en-en" / "English.jsonl.gz"


def is_word(s: str) -> bool:
    """Lowercase Latin letters only (accents allowed). wordfreq splits on hyphens, so hyphenated
    lemmas could not be ranked and are left out."""
    return s.isalpha() and s.islower() and all(ch < "ɐ" for ch in s)


# A sense tagged with any of these is dialect, or belongs to a non-Anglosphere variety or a
# specific community, and does not make the word general English. US regions, London and
# Cockney slang, spelling conventions (Oxford) and topic tags (Norse, Unix) do not count.
REGIONAL_TAGS = {
    "dialectal", "regional",
    "Scotland", "Northern-England", "Geordie", "Yorkshire", "Cornwall", "Wales", "North-Wales",
    "Shetland", "Orkney", "Midlands", "Northumbria", "West-Country", "Northern-Ireland",
    "India", "South-Asia", "Pakistan", "Bangladesh", "Nepal", "Sri-Lanka", "Hinglish",
    "Philippines", "Singapore", "Singlish", "Malaysia", "Manglish", "Brunei", "Indonesia",
    "Hong-Kong", "China", "Taiwan", "Myanmar", "Japan", "Africa", "Nigeria", "Kenya", "Ghana",
    "South-Africa", "Jamaica", "Caribbean", "Guyana", "Trinidad-and-Tobago", "Polari",
    "Judaism", "Hinduism", "Sikhism", "Jainism", "Buddhism", "Islam",
}
SPELLING_OF = re.compile(r"\bspelling of\b|\b(?:alternative|archaic|obsolete) form of\b", re.I)
# A direct borrowing from a living language; learned Latin and Greek coinages are English words.
BORROWED = re.compile(r"(?:\b[Bb]orrowed from|\b[Bb]orrowing from|^Transliteration of|^From)\s+((?:[A-Z][\w-]*\s?){1,3})")
NOT_A_BORROWING = re.compile(r"\b(?:English|Latin|Greek|Translingual|Proto-[\w-]+)\b")


def regional(tags: set[str]) -> bool:
    return bool(tags & REGIONAL_TAGS)


def borrowed(etymology: str) -> bool:
    m = BORROWED.search(etymology[:200])
    return bool(m) and not NOT_A_BORROWING.search(m.group(1))


def parse_wiktionary() -> dict:
    """{lemmas: word → [{pos, glosses, borrowed}], form_of: form → [lemma], inflects: words with a
    form-of sense, variant: words whose usable senses all say "spelling of", regional: words
    whose usable senses are all regional or community-specific, proper: lowercased names}."""
    cache = lang_dir("en") / "kaikki_en_v3.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    lemmas: dict[str, list[dict]] = defaultdict(list)
    form_of: dict[str, set[str]] = defaultdict(set)
    inflects: set[str] = set()
    naturalised: set[str] = set()
    non_variant: set[str] = set()
    proper: set[str] = set()
    with gzip.open(EXTRACT, "rt", encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            word, pos = d.get("word", ""), d.get("pos", "")
            if pos == "name" or (word[:1].isupper() and word[1:].islower()):
                if word.isalpha():
                    proper.add(word.lower())
                continue
            if not is_word(word):
                continue
            good, low = [], []
            for s in d.get("senses", []):
                tags = set(s.get("tags") or [])
                if s.get("form_of") and "misspelling" not in tags:
                    inflects.add(word)
                targets = [t.get("word", "") for t in (s.get("form_of") or []) + (s.get("alt_of") or [])]
                if targets and "misspelling" not in tags:
                    form_of[word].update(t for t in targets if is_word(t))
                if targets or tags & NOT_A_SENSE:
                    continue
                gl = s.get("glosses") or []
                if gl and pos in WIKT_POS:
                    text = gl[-1].strip()
                    (low if tags & LOW else good).append(text)
                    if not tags & LOW:
                        if not regional(tags):
                            naturalised.add(word)
                        if not SPELLING_OF.search(text):
                            non_variant.add(word)
            if good:  # a lemma needs at least one sense without an obsolete/rare/… tag
                ety = re.sub(r"^Etymology tree .*?(?=From |Borrowed |$)", "", d.get("etymology_text") or "")
                lemmas[word].append({"pos": WIKT_POS[pos], "glosses": list(dict.fromkeys(good + low))[:6],
                                     "borrowed": borrowed(ety)})
    out = {"lemmas": lemmas, "form_of": {k: sorted(v) for k, v in form_of.items()},
           "inflects": sorted(inflects & set(lemmas)), "variant": sorted(set(lemmas) - non_variant),
           "regional": sorted(set(lemmas) - naturalised), "proper": sorted(proper)}
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def oewn_lemmas(w: wn.Wordnet) -> set[str]:
    return {x.lemma() for x in w.words() if is_word(x.lemma())}


# A form that inflects another lemma but is a lemma only in Wiktionary, not OEWN (came: a rare
# noun, but really the past of come), claims its own frequency at this weight.
SELF_HOMOGRAPH_WEIGHT = 0.05


def rank_scores(vocab: set[str], oewn: set[str], form_of: dict[str, list[str]],
                morphy: Morphy) -> tuple[dict[str, float], int, int]:
    """Sum wordfreq frequencies of each form into its lemmas: the form itself if it is a lemma,
    Morphy's OEWN lemmas, and Wiktionary's form-of targets. A form with several candidates splits
    its frequency in proportion to each candidate's own frequency as a bare word, so "number" goes
    almost all to number rather than numb, and "saw" mostly to see."""
    freqs = wordfreq.get_frequency_dict("en", "large")
    scores: dict[str, float] = defaultdict(float)
    forms = unknown = 0
    for form, fr in freqs.items():
        if not is_word(form):
            continue
        forms += 1
        others = {lem for ls in morphy(form).values() for lem in ls if lem in vocab and lem != form}
        others |= {lem for lem in form_of.get(form, []) if lem in vocab and lem != form}
        cands = others | ({form} & vocab)
        if not cands:
            unknown += 1
            continue
        prior = {c: freqs.get(c, 0.0) + 1e-12 for c in cands}
        if form in prior and others and form not in oewn:
            prior[form] *= SELF_HOMOGRAPH_WEIGHT
        total = sum(prior.values())
        for c in cands:
            scores[c] += fr * prior[c] / total
    return scores, forms, unknown


def oewn_gloss(lemma: str, w: wn.Wordnet) -> tuple[str, list[str], list[str]]:
    """(pos, glosses, all definitions). First sense of each POS (the POS with the most senses
    first, since OEWN 2024 ships no sense frequencies), then more senses of the main POS."""
    by_pos: dict[str, list[str]] = defaultdict(list)
    for x in w.words(lemma):
        if x.lemma() != lemma:
            continue
        pos = OEWN_POS[x.pos]
        for s in x.senses():
            d = s.synset().definition()
            if d and d not in by_pos[pos]:
                by_pos[pos].append(d)
    order = sorted(by_pos, key=lambda p: -len(by_pos[p]))
    glosses = [by_pos[p][0] for p in order][:MAX_GLOSSES]
    for d in by_pos[order[0]][1:]:
        if len(glosses) >= MAX_GLOSSES:
            break
        glosses.append(d)
    # Every definition, interleaved across POS so a cap keeps senses of each (fire: verb and noun).
    rounds = max((len(v) for v in by_pos.values()), default=0)
    return ",".join(order), glosses, [by_pos[p][i] for i in range(rounds) for p in order if i < len(by_pos[p])]


def wikt_gloss(entries: list[dict]) -> tuple[str, list[str]]:
    """Same spirit as French: first gloss of each entry in Wiktionary's order, then more of the
    first entry's."""
    glosses = list(dict.fromkeys(e["glosses"][0] for e in entries))[:MAX_GLOSSES]
    for g in entries[0]["glosses"][1:]:
        if len(glosses) >= MAX_GLOSSES:
            break
        if g not in glosses:
            glosses.append(g)
    return ",".join(dict.fromkeys(e["pos"] for e in entries)), glosses


BORROWING_ZIPF = 2.0
CLEANUP_STAGES = {
    "inflection": "drop Wiktionary-only inflections or spellings",
    "regional": "drop Wiktionary-only regional/community words",
    "borrowing": f"drop Wiktionary-only rare borrowings (Zipf<{BORROWING_ZIPF})",
}


def cleanup_rules(wikt: dict, wiktionary_only: set[str]) -> dict[str, str]:
    """lemma → rule, for Wiktionary-only lemmas (OEWN entries are standard English already):
    inflected forms or spelling variants of another lemma (plates, worked, organise); words whose
    usable senses are all regional or community-specific (nain, sansad, amol); and direct
    borrowings that are still rare as English words (recit, morra, gac)."""
    out = {}
    for lem in wiktionary_only & (set(wikt["inflects"]) | set(wikt["variant"])):
        out[lem] = "inflection"
    for lem in wiktionary_only & set(wikt["regional"]):
        out.setdefault(lem, "regional")
    for lem in wiktionary_only - set(out):
        if all(e["borrowed"] for e in wikt["lemmas"][lem]) and wordfreq.zipf_frequency(lem, "en") < BORROWING_ZIPF:
            out[lem] = "borrowing"
    return out


def print_cleanup_examples(wikt: dict, cleanup: dict[str, str], n: int = 30) -> None:
    """30 random examples per cleanup rule, among words common enough to have made the list."""
    import random
    rng = random.Random(5)
    for rule in CLEANUP_STAGES:
        pool = sorted(lem for lem, r in cleanup.items() if r == rule and wordfreq.zipf_frequency(lem, "en") >= ZIPF_FLOOR)
        print(f"[en]   {rule}: {len(pool):,} of them at Zipf ≥ {ZIPF_FLOOR}; examples:")
        for lem in sorted(rng.sample(pool, min(n, len(pool)))):
            print(f"[en]     {lem:<16} {wikt['lemmas'][lem][0]['glosses'][0][:90]}")


def build_rows(w: wn.Wordnet) -> tuple[Stages, set[str]]:
    wikt = parse_wiktionary()
    oewn = oewn_lemmas(w)
    wl = set(wikt["lemmas"])
    vocab = oewn | wl
    print(f"[en] OEWN single-word lowercase lemmas                {len(oewn):>8,}")
    print(f"[en] en.wiktionary lemmas after sense/POS rules       {len(wl):>8,}")
    print(f"[en]   of which not in OEWN                           {len(wl - oewn):>8,}")
    cleanup = cleanup_rules(wikt, wl - oewn)
    scores, forms, unknown = rank_scores(vocab - set(cleanup), oewn, wikt["form_of"], Morphy(w))
    print(f"[en] wordfreq 'large' lowercase-letter forms          {forms:>8,}")
    print(f"[en]   forms with no lemma in the vocabulary          {unknown:>8,}")
    proper = set(wikt["proper"])
    rows = []
    for lemma in vocab:
        if lemma in cleanup:
            rows.append({"lemma": lemma, "score": 0.0, "cleanup": cleanup[lemma]})
            continue
        score = scores.get(lemma, 0.0)
        if not score:  # never seen by wordfreq: dropped at the first stage, skip the lookups
            rows.append({"lemma": lemma, "score": 0.0})
            continue
        if lemma in oewn:
            pos, glosses, defs = oewn_gloss(lemma, w)
            abbrev = not has_vowel(lemma) or all(ABBREV.search(d) for d in defs)
            source = "oewn"
        else:
            pos, glosses = wikt_gloss(wikt["lemmas"][lemma])
            defs = [g for e in wikt["lemmas"][lemma] for g in e["glosses"]]
            abbrev = not has_vowel(lemma) or bool(ROMAN.match(lemma))  # lii, xiv; OEWN keeps mix, civil
            source = "wiktionary"
        also_proper = lemma in proper or any(x.lemma() != lemma for x in w.words(lemma) if x.lemma().lower() == lemma)
        rows.append({"lemma": lemma, "score": score, "zipf": math.log10(score * 1e9),
                     "pos": pos, "glosses": {"en": glosses}, "abbrev": abbrev, "also_proper": also_proper,
                     "all_glosses": list(dict.fromkeys(defs))[:MAX_ALL_GLOSSES],
                     "gloss_source": source})
    st = Stages("en", rows, "vocabulary (OEWN ∪ Wiktionary)")
    for rule, label in CLEANUP_STAGES.items():
        st.keep(label, lambda r, rule=rule: r.get("cleanup") != rule)
    print_cleanup_examples(wikt, cleanup)
    st.keep("drop lemmas with no wordfreq frequency", lambda r: r["score"] > 0)
    standard_drops(st, "en")
    return st, oewn


def compare_floors(rows: list[dict]) -> None:
    out = lang_dir("en") / "floors"
    out.mkdir(exist_ok=True)
    print("\n[en] Zipf floor   lemmas   bands   from OEWN   Wiktionary-only")
    for floor in COMPARE_FLOORS:
        kept = [r for r in rows if r["zipf"] >= floor]
        ranked = assign_ranks([dict(r) for r in kept])
        n_bands = (len(ranked) - 1) // BAND_SIZE + 1
        wo = sum(r["gloss_source"] == "wiktionary" for r in kept)
        print(f"[en] {floor:>10}  {len(kept):>7,}  {n_bands:>6}  {len(kept) - wo:>10,}  {wo:>16,}")
        tail = [r for r in ranked if r["band"] >= n_bands - 3]
        dump_band_samples("en", tail, path=out / f"zipf_{floor}.txt", quiet=True)
    print(f"[en] tail samples (last 3 bands per floor) in {out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--compare", action="store_true", help="print list size and tail samples per Zipf floor")
    ap.add_argument("--floor", type=float, default=ZIPF_FLOOR)
    a = ap.parse_args()
    w = wn.Wordnet("oewn:2024")
    st, _ = build_rows(w)
    if a.compare:
        compare_floors(st.rows)
        return
    st.keep(f"drop below Zipf {a.floor} (wordfreq)", lambda r: r["zipf"] >= a.floor)
    st.write_report()
    ranked = assign_ranks(st.rows)
    src = defaultdict(int)
    for r in st.rows:
        src[r["gloss_source"]] += 1
    print(f"[en] glosses from {dict(src)}")
    write_lemmas("en", ranked)
    dump_band_samples("en", ranked)


if __name__ == "__main__":
    main()
