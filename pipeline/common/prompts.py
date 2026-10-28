"""Prompts and structured-output schemas for enrichment (generation), Sonnet review and the
practice-game content."""

import json
import re
import unicodedata

FLAGS = ["jargon", "archaic", "offensive", "technical"]
# Definition languages each course offers. The French course lets the user pick either.
DEF_LANGS = {"en": ["en"], "fr": ["fr", "en"]}
LANG_NAME = {"en": "English", "fr": "French"}

LEARNERS = {
    "en": "Learners are adults who already speak English and want to grow their vocabulary, from "
          "everyday words up to rare literary ones.",
    "fr": "Learners are adults learning French, from beginners up to advanced readers. They choose "
          "whether definitions are shown in French or in English, so every definition and "
          "distractor is written in both languages.",
}

RUBRIC = """\
usefulness (1-5): how worth teaching this word is to such a learner, as a word on its own.
  5 core everyday vocabulary
  4 common; any educated adult knows it
  3 useful but less common, formal or literary
  2 rare, specialised or technical, but a real word of the language that a curious reader can
    meet (every genuine word, however rare, is at least 2)
  1 not a word worth teaching on its own: an inflected form of another word (came, strumming),
    a misspelling or respelling, a name, a fragment, a numeral, or a foreign word not used in
    the language
  Judge usefulness on its own scale; the frequency rank is only a hint (rare words can be a 3,
  and a noisy web-frequency list puts some junk high).

flags: zero or more of
  jargon     specialised vocabulary of one field or trade
  technical  scientific, medical, legal or engineering term
  archaic    the word itself is obsolete or old-fashioned in every common sense (a current
             word for an old thing, like cithara, is not archaic)
  offensive  a slur, or a word whose main sense is vulgar or obscene"""

GEN_TASK = """\
For each word, write:

- definition: the sense a learner most needs (the most common modern sense, not the first gloss
  if that is a rare one), as one short dictionary-style definition of at most 15 words. Define
  one sense of one part of speech: never join two senses with "or" or ";". Never use the word
  itself or any word from its family (not "parfum" to define parfumé, not "comprendre" for
  compréhensible). {def_rule}
- distractors: exactly 3 wrong definitions per definition language, for a multiple-choice
  question. Each matches the definition in part of speech, grammatical shape, length and style,
  and describes the same kind of thing (other emotions for an emotion, other tools for a tool,
  other pronoun meanings for a pronoun), so a learner who does not know the word cannot rule it
  out by form. None may be true of any sense of the word (check every gloss given) or of a near
  synonym, and none may paraphrase the definition. Write the distractors for each language directly in that language, in the
  same register as the definition.
- example: one natural sentence in {lang_name}, 8-20 words, that contains the word itself
  (inflected if needed, not a compound or derivative of it) in the defined sense, with context that hints at the meaning without defining it.
- usefulness and flags, per the rubric.

The dictionary glosses come from {source} and can be noisy: a rare sense first, markup, or a
gloss for a different word. Use your own knowledge of {lang_name}. A word marked
also_proper_noun is also a name (as japan / Japan); judge and define only the common word."""

DEF_RULE = {
    "en": "",
    "fr": "Write it in French (simple French a B1 learner can follow) and in English; both say "
          "the same thing.",
}
SOURCE = {"en": "Open English WordNet", "fr": "French and English Wiktionary"}

REVIEW_TASK = """\
Each word comes with a candidate entry written by another model: definition, distractors and
example. Check it, and also score the word yourself.

- usefulness and flags: your own judgement from the rubric, independent of the candidate.
- definition_ok: false if the definition is wrong, misleading, not the sense a learner most
  needs, or uses the word itself or its family.
- distractors_ok: false if any distractor is actually true of some sense of the word, is a
  paraphrase of the definition, is implausible at a glance (wrong part of speech, absurd, very
  different in length or style), or is in the wrong language.
- example_ok: false if the example uses a different sense than the definition, is
  ungrammatical or unnatural, or does not contain the word.
- note: when anything is false, a few words saying what is wrong; otherwise empty."""


REPAIR_TASK = """\
Each word comes with a candidate entry written by another model for a multiple-choice question:
a definition (the right answer), 3 distractors (wrong answers) and an example sentence. Using
all the glosses given and your own knowledge of every sense of the word in every part of
speech, check the entry for these harmful problems only:

(a) a distractor that is actually true of the word in some sense or part of speech, so a
    learner who picked it would be right;
(b) a definition that is wrong, or gives a minor sense when a much more common one exists;
(c) a factual error in the definition or the example;
(d) an example that is ungrammatical, or uses the word in a different sense than the definition.

Nothing else is in scope: not style, length or register, not how easy a distractor is to rule
out, not whether the word is worth teaching. Most entries have no harmful problem; return those
with every field empty.

For each problem, say what is wrong in a few words and write the fix:
- bad_distractors: one item per distractor with problem (a): its index (0, 1 or 2), the reason,
  and a replacement wrong definition in the same style and length as the others, false of every
  sense of the word, and as plausible as a good distractor: the same kind of thing, not just an
  opposite.
- definition_problem and definition_fix: for (b) or (c), the reason and a corrected definition
  (at most 15 words, one sense of one part of speech, not using the word or its family). If you
  change the definition, make sure the distractors and example still fit it, and fix any that
  no longer do.
- example_problem and example_fix: for (c) or (d), the reason and a corrected example sentence
  (8-20 words, containing the word itself in the defined sense)."""


GAMES_TASK = """\
Each word comes with its definition (the one sense the app teaches) and an example sentence
already shown to learners. Write practice-game content for that defined sense only, all in
{lang_name}:

- synonyms: 0 to 3 single words or short phrases (at most 3 words) a learner would accept as
  meaning the same thing in the defined sense. Prefer common words over rare ones. Leave empty
  when there is no real synonym; never pad with loose associations.
- antonyms: 0 to 3 true opposites in the defined sense. Most words have none (concrete nouns
  almost never do); leave it empty rather than forcing one.
- cloze: a natural sentence of 8-20 words containing ___ exactly once, where the word, in the
  inflected form given as answer, is the only reasonable fit for the blank. The sentence must
  differ from the example. answer is exactly what fills the blank (the word itself or an
  inflection of it, not a derivative). bank: exactly 3 other words of the same part of speech
  and similar difficulty, inflected the same way (and agreeing in gender where it shows), that
  make the sentence false or absurd. Test each bank word by putting it in the blank: if the
  sentence could still be true, even loosely or in some other situation, replace it. Close
  relatives of the answer almost always fit (trolley for pram, ferry for speedboat, badger for
  razorback, listened for rewound), so pick words the sentence's details rule out.
- usage: correct is one sentence that uses the word correctly in the defined sense. wrong is
  exactly 3 sentences that MISUSE the word in ways a learner who half-knows it would actually
  produce, each a different kind of mistake from this list:
  (a) confusing it with a similar-looking or similar-sounding word, or a related word from the
      same family (disinterested for uninterested, affect for effect);
  (b) a wrong collocation, preposition or construction (depend of, discuss about);
  (c) the wrong part of speech, or a nearby but wrong shade of meaning (using it where a
      related word with a different nuance belongs).
  Each wrong sentence keeps a realistic topic where the word could appear, so the learner has to
  know the word to spot the mistake; never write a sentence that is just absurd (a monkey
  swimming an ocean, a pram with an engine) or that contradicts itself. A wrong sentence must not
  be correct in ANY sense of the word, including senses other than the defined one: for fire,
  "the coach fired his striker" and "she fired a pistol" are correct English, so they cannot be
  wrong options. Every usage sentence contains the word itself, written as the lemma or as the
  cloze answer, or as a regular inflection of the lemma (not an irregular form such as went or
  va). All four differ from the example and the cloze sentence.

Sentences are 8-20 words, natural, and suitable for adult learners. Use your own knowledge of
{lang_name}; the glosses are only a hint."""


def system_prompt(lang: str, kind: str) -> str:
    head = (f"You are writing the word list for a {LANG_NAME[lang]} vocabulary-learning app. "
            f"{LEARNERS[lang]}\n\n")
    if kind == "gen":
        return head + RUBRIC + "\n\n" + GEN_TASK.format(def_rule=DEF_RULE[lang], lang_name=LANG_NAME[lang], source=SOURCE[lang])
    if kind == "repair":
        return head + REPAIR_TASK
    if kind == "games":
        return head + GAMES_TASK.format(lang_name=LANG_NAME[lang])
    return head + RUBRIC + "\n\n" + REVIEW_TASK


def word_input(lang: str, w: dict, candidate: dict | None = None, kind: str = "") -> dict:
    x = {"rank": w["rank"], "lemma": w["lemma"], "pos": w["pos"]}
    for k in ("en", "fr"):
        if w["glosses"].get(k):
            x[f"glosses_{k}"] = w["glosses"][k]
    if kind == "repair" and w.get("all_glosses"):  # repair checks distractors against every sense
        x["glosses_en"] = w["all_glosses"]
    if w.get("also_proper"):
        x["also_proper_noun"] = True
    if kind == "games":  # the sense to practise, in the word's own language
        x["definition"] = candidate["definition"][lang]
        x["example"] = candidate["example"]
    elif candidate:
        x["candidate"] = {k: candidate[k] for k in ("definition", "distractors", "example")}
    return x


def user_prompt(lang: str, words: list[dict], kind: str, candidates: dict[int, dict] | None = None) -> str:
    lines = [json.dumps(word_input(lang, w, candidates[w["rank"]] if candidates else None, kind), ensure_ascii=False)
             for w in words]
    return (f"{len(words)} words, one JSON object per line (rank: position in the frequency list, "
            f"1 = most frequent). Return exactly one entry per word, in the same order, copying rank "
            f"and lemma.\n\n" + "\n".join(lines))


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props),
            "additionalProperties": False}


def _per_lang(lang: str, schema: dict) -> dict:
    return _obj({k: schema for k in DEF_LANGS[lang]})


def schema(lang: str, kind: str) -> dict:
    common = {
        "rank": {"type": "integer"},
        "lemma": {"type": "string"},
        "usefulness": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "flags": {"type": "array", "items": {"type": "string", "enum": FLAGS}},
    }
    if kind == "repair":
        assert lang == "en", "repair runs on the English course only"
        item = _obj({
            "rank": {"type": "integer"},
            "lemma": {"type": "string"},
            "bad_distractors": {"type": "array", "items": _obj({
                "index": {"type": "integer", "enum": [0, 1, 2]},
                "reason": {"type": "string"},
                "replacement": {"type": "string"},
            })},
            "definition_problem": {"type": "string"},
            "definition_fix": {"type": "string"},
            "example_problem": {"type": "string"},
            "example_fix": {"type": "string"},
        })
    elif kind == "games":
        words = {"type": "array", "items": {"type": "string"}}
        item = _obj({
            "rank": {"type": "integer"},
            "lemma": {"type": "string"},
            "synonyms": words,
            "antonyms": words,
            "cloze": _obj({"sentence": {"type": "string"}, "answer": {"type": "string"}, "bank": words}),
            "usage": _obj({"correct": {"type": "string"}, "wrong": words}),
        })
    elif kind == "gen":
        item = _obj({
            **common,
            "definition": _per_lang(lang, {"type": "string"}),
            "distractors": _per_lang(lang, {"type": "array", "items": {"type": "string"}}),
            "example": {"type": "string"},
        })
    else:
        item = _obj({
            **common,
            "definition_ok": {"type": "boolean"},
            "distractors_ok": {"type": "boolean"},
            "example_ok": {"type": "boolean"},
            "note": {"type": "string"},
        })
    return _obj({"words": {"type": "array", "items": item}})


def valid_gen(lang: str, e: dict) -> bool:
    """Checks structured outputs cannot express: three non-empty distractors per language."""
    for k in DEF_LANGS[lang]:
        if not e["definition"].get(k, "").strip():
            return False
        ds = e["distractors"].get(k, [])
        if len(ds) != 3 or not all(d.strip() for d in ds):
            return False
    return bool(e["example"].strip())


BLANK = re.compile(r"_{3,}")


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.casefold()) if not unicodedata.combining(c))


def contains_word(lemma: str, sentence: str, forms: tuple[str, ...] = ()) -> bool:
    """The sentence has the lemma or an inflection of it: its stem (the lemma minus up to 2 final
    letters, so try → tried, venir → venons) or one of the given forms, ignoring case and accents.
    Irregular forms the stem misses (went, va) pass only if given in forms."""
    s = _fold(sentence)
    stem = _fold(lemma)[:max(2, len(lemma) - 2)]
    return stem in s or any(f.strip() and _fold(f) in s for f in forms)


def valid_games(lang: str, e: dict) -> bool:
    """Checks structured outputs cannot express: one blank, an answer, 3 bank words and 3 wrong
    usages, and the word itself in every usage sentence (the cloze answer counts as one of its
    forms)."""
    cz, us = e["cloze"], e["usage"]
    answer = cz["answer"].strip()
    if len(BLANK.findall(cz["sentence"])) != 1 or not answer:
        return False
    bank = [b.strip() for b in cz["bank"]]
    if len(bank) != 3 or not all(bank) or _fold(answer) in {_fold(b) for b in bank}:
        return False
    sentences = [us["correct"], *us["wrong"]]
    if len(us["wrong"]) != 3 or len({_fold(s.strip()) for s in sentences}) != 4:
        return False
    return all(contains_word(e["lemma"], s, (answer,)) for s in sentences)
