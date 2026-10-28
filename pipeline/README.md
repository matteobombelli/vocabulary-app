# Word pipeline

Offline Python that builds the `words` table: a frequency-ranked lemma list per language, enriched
by Claude through the Message Batches API, written out as D1 seed SQL. Everything it downloads or
writes lives in `pipeline/data/` (gitignored).

```
en.py  fr.py     adapters: frequency list → lemmas → glosses → drop rules → data/<lang>/lemmas.jsonl
enrich.py        Haiku pass, Sonnet review-and-repair of EN bands 0-8, Haiku game content
                 (Batch API, structured outputs)
seed.py          data/seed/<lang>-NNN.sql chunks + data/seed/<lang>-words.jsonl.gz
common/          paths, filter stages and bands, prompts and schemas, batch plumbing
```

## Setup

```bash
cd pipeline
uv venv .venv --python 3.13
uv pip install --python .venv/bin/python -r requirements.txt
```

Run every script with `-I` (isolated mode), since they read downloaded files.

## 1. Downloads

Each source goes in its own directory under `data/downloads/`:

```bash
D=data/downloads; mkdir -p $D/{kaikki-en-en,lexique,kaikki-en-fr,kaikki-fr-fr,ldnoobw,wn}
curl -L -o $D/kaikki-en-en/English.jsonl.gz https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
curl -L -o $D/lexique/Lexique383.tsv http://www.lexique.org/databases/Lexique383/Lexique383.tsv
curl -L -o $D/kaikki-en-fr/French.jsonl.gz https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl.gz
curl -L -o $D/kaikki-fr-fr/Francais.jsonl.gz "https://kaikki.org/frwiktionary/Fran%C3%A7ais/kaikki.org-dictionary-Fran%C3%A7ais.jsonl.gz"
L=https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master
curl -L -o $D/ldnoobw/en $L/en
curl -L -o $D/ldnoobw/fr $L/fr
WN_DATA_DIR=$D/wn .venv/bin/python -I -c "import wn; wn.download('oewn:2024')"
```

About 1 GB in total, mostly the three kaikki extracts. wordfreq ships its frequency data inside
the pip package.

## 2. Lemma lists

```bash
.venv/bin/python -I en.py --compare   # list size and tail samples at several Zipf floors
.venv/bin/python -I en.py     # first run parses the kaikki extract into data/en/kaikki_en.json
.venv/bin/python -I fr.py     # first run ~1 min (parses the kaikki extracts into data/fr/kaikki_*.json)
```

Each prints the row count after every filter stage (also saved in `data/<lang>/filter_stages.json`,
with the dropped lemmas per stage in `dropped.json`) and writes `band_samples.txt`, 50 random words
per 2,500-rank band, for review.

**English.** The vocabulary is the union of Open English WordNet 2024's single-word lemmas and
en.wiktionary's English lemmas (through kaikki.org). A Wiktionary entry counts only for the
content and function POS (names, abbreviations, symbols, affixes, phrases and contractions are
out), and form-of, alt-of, misspelling and abbreviation senses don't count. A lemma needs at least
one sense not tagged obsolete, archaic, rare, dated or nonstandard. Lemmas must be lowercase
letters only. wordfreq splits on hyphens, so hyphenated lemmas could not be ranked and are left
out. Slang and informal words stay; enrichment decides if they're worth teaching.

Three more rules apply to Wiktionary-only lemmas (OEWN entries are standard English already). Each
one removes its words before ranking, so their frequency goes to the right lemma. `en.py` prints
30 examples per rule:
- **Inflections and spelling variants:** a form-of sense or a "spelling of" gloss (plates, worked,
  narcotics, organise).
- **Regional or community-only words:** every usable sense is tagged dialectal, regional, or with a
  tag in `REGIONAL_TAGS`. That list covers British-Isles dialect regions, non-Anglosphere
  varieties, and religious communities (nain, sansad, amol). US regional words, London slang, and
  topic tags don't count.
- **Rare direct borrowings:** the etymology says borrowed, transliterated, or "From <language>"
  (not Latin, Greek or an English stage), and the word's own Zipf is under 2.0 (recit, morra,
  gac).

Lemmas are ranked by [wordfreq](https://github.com/rspeer/wordfreq) English frequency (its
"large" list), summed over each lemma's forms. A form counts toward the form itself if it's a
lemma, its OEWN lemmas via Morphy, and its Wiktionary form-of targets. A form with several
candidates splits its frequency in proportion to each candidate's own frequency as a bare word,
so "number" doesn't hand a third of its count to "numb". A form that inflects another lemma but
is a lemma only in Wiktionary, not OEWN, claims its own frequency at 5% (came is a rare noun on
Wiktionary but really the past of come; this also clears out resting, averaged, tackled…), while
real homographs OEWN knows (left, found, felt) keep theirs. A lemma whose summed frequency is below
**Zipf 1.25** (about 1.8 per 100 million words) is cut. `en.py --compare` prints the list size at
several floors and writes the last 3 bands of each to `data/en/floors/`:

| Zipf floor | 1.0 | 1.25 | 1.5 | 1.75 | 2.0 | 2.5 |
|---|---|---|---|---|---|---|
| lemmas | 72,895 | **63,083** | 54,345 | 46,574 | 39,702 | 27,396 |

1.25 is the lowest floor where the tail is still mostly words an educated adult might meet
(viands, epithalamium, neoteny, beastliness). At 1.0 it turns mostly technical and obscure
(acetoacetyl, tosylate, yitong). Even with no floor, only ~85k lemmas have any wordfreq frequency.

Glosses come from OEWN when the lemma is there: at most 3, the first sense of each POS (the POS
with the most senses first, since OEWN ships no sense frequencies), then more senses of the main
POS. Otherwise they are up to 3 Wiktionary glosses: the first of each entry in Wiktionary's
order, untagged senses before obsolete or rare ones. Lemmas that also exist as a proper noun
(japan / Japan) are kept and marked `also_proper`, because wordfreq lowercases everything. The
model is told to judge only the common word.

**French.** Lexique 3.83 lemmas, scored by the mean of `freqlemfilms2` and `freqlemlivres`,
summed over the lemma's grammatical categories. English glosses come from en.wiktionary's French
entries and French glosses from fr.wiktionary, both through kaikki.org. Form-of and alt-of senses
are skipped, archaic, rare and similar senses go last, and the entries matching the lemma's
Lexique category come first. Lexique 3.83 has no proper-noun category, so a lemma whose Wiktionary
entries are all proper nouns is dropped as proper-noun-only. A lemma needs at least one gloss in
each language to stay.

**Both.** Drop lemmas under 3 letters, abbreviations (English: an OEWN definition saying
"abbreviation", or no vowel, which covers mph and Roman numerals, on top of the Wiktionary sense
rules; French: every Wiktionary entry an abbreviation; Roman numerals such as lii for Wiktionary-only English words), and words on the
LDNOOBW list for the
language.

## 3. Enrichment

Credentials: the Anthropic SDK reads `ANTHROPIC_API_KEY`, or the profile from `ant auth login`. A key can
also go in `data/.env` (gitignored) as `ANTHROPIC_API_KEY=...`, loaded with `set -a; . data/.env; set +a`.

For each word, the model returns usefulness 1–5, flags (jargon, archaic, offensive, technical),
the learner-relevant `definition`, 3 `distractors` per definition language (English for the EN
course; French and English for the FR course), and one `example` sentence in the word's
language. Requests carry 50 lemmas each and use structured outputs. Prompts and schemas are in
`common/prompts.py`.

A word is **eligible** when usefulness ≥ 2 and it is not flagged offensive or archaic.
Ineligible words stay in `words`, because the vocabulary estimate sums over the whole list.

Every `submit` first prints the estimated cost and then asks for confirmation (`--confirm` skips
the prompt). Input tokens are counted with `count_tokens`, and output tokens per word are measured
from the stages already collected. `collect` downloads finished batches, validates every entry,
and prints the actual cost. Running `submit` again sends only words that still have no result, in
chunks of 10, so it doubles as a retry.

Haiku (`claude-haiku-5-5`) writes every entry in both languages. Sonnet
(`claude-sonnet-5-5`) then reviews and repairs every English word in bands 0–8 (ranks
1–22,500). That's the polysemous head, where a distractor is most likely to be a real sense of
the word. Repair sees every gloss for the word and looks only for harmful problems:
- a distractor that is a real sense of the word in any part of speech
- a definition that is wrong, or gives a minor sense when a much more common one exists
- a factual error in the definition or example
- an example that is ungrammatical or uses the word in another sense

Style, plausibility and usefulness are out of scope. For flagged words, Sonnet writes the reason
and a fix for just the flagged fields, and Haiku's other fields stay. `source_model` is Sonnet's
for any word it rewrote. Eligibility always comes from Haiku's usefulness score.

```bash
E=".venv/bin/python -I enrich.py"
$E submit en pilot                # Haiku on ~300 words spread over all bands
$E collect en pilot --wait
$E submit en pilot-repair         # Sonnet review-and-repair of the pilot words in bands 0-8
$E collect en pilot-repair --wait
$E submit en pilot-repair-check   # Sonnet re-checks the words it repaired
$E collect en pilot-repair-check --wait
$E bands en --pilot               # harmful rate per band, before and after repair
$E report en pilot-repair         # → data/en/pilot-repair_report.md: each flagged word before/after

$E submit en haiku                # Haiku on every lemma (and: $E submit fr haiku)
$E collect en haiku --wait
$E submit en repair               # Sonnet review-and-repair of every word in bands 0-8
$E collect en repair --wait
$E submit en repair-check         # optional: re-check repaired words for the after rate
$E collect en repair-check --wait
$E bands en                       # → data/en/bands.json
```

### Tiers and game content

Each word gets a **tier**, which decides which learners see it (`tier()` in `enrich.py`):

| tier | rule | shown to |
|---|---|---|
| 3 | usefulness ≥ 4 | beginner, intermediate, fluent, native |
| 2 | usefulness 3 | intermediate, fluent, native |
| 1 | usefulness 2, not flagged technical or jargon | fluent, native |
| 0 | anything else, or not eligible | nobody |

Teachable words (tier ≥ 1) then get content for the practice games, written by Haiku
(`claude-haiku-5-5`, effort low) in the word's own language for the sense of the final definition
(Haiku's entry with Sonnet's repairs for English), with the shipped example sentence as context:
- `synonyms`: 0–3 words or short phrases that mean the same in that sense; `antonyms`: 0–3 true
  opposites (usually none for concrete nouns).
- `cloze`: a sentence with `___` once, the `answer` that fills it (the word or an inflection),
  and a `bank` of 3 same-POS words that don't fit.
- `usage`: one `correct` sentence and 3 `wrong` ones that misuse the word in ways that could
  fool a learner who half-knows it.

`collect` rejects an entry unless the cloze has exactly one blank, the answer is non-empty and not
in the bank, the bank and the wrong usages number 3, and every usage sentence contains the word:
its stem (the lemma minus up to 2 final letters) or the cloze answer, ignoring case and accents.
Irregular forms (went, va) fail that check, so the prompt asks for regular forms; rejected words
go back in the next `submit`. Extra bank words or wrong usages are trimmed to 3, and synonyms
or antonyms equal to the word are dropped.

```bash
$E estimate en games-pilot        # the teachable pilot words (also: fr)
$E submit en games-pilot
$E collect en games-pilot --wait
$E report en games-pilot          # → data/en/games-pilot_report.md for hand review
$E submit en games                # every teachable word (and: $E submit fr games)
$E collect en games --wait
```

The games stages run Haiku at high effort: at low effort a quarter of the words had a "wrong"
usage that is correct in some sense, and French was worse. High effort measured 3,369 output
tokens a word (en) and 4,426 (fr), so the full games stage costs about $34 (en) and $32 (fr).

### Games through a cloud session

`cloud_games.py` is the same stage written by Claude Code subagents instead of the Batch API:
`export` writes `cloud/<lang>-input.jsonl` (teachable words with no games yet, core words first)
and `cloud/<lang>-prompt.md` (the batch system prompt plus the output format); a cloud session on a
branch that carries them runs `todo` → one subagent per chunk → `check`, and pushes
`cloud/out/<lang>/`. Back here, `import` appends every line that passes the batch parser to the
games stage. `cloud/` is gitignored on main.

```bash
$E2 export en                     # E2=".venv/bin/python -I cloud_games.py"
$E2 import en                     # after pulling the branch's cloud/out/
```

## 4. Seed

The seed carries `games` (JSON `{"synonyms", "antonyms", "cloze": {"sentence", "answer", "bank"},
"usage": {"correct", "wrong"}}` from the games stage, falling back to games-pilot, or `{}` for a
word without game content) and `tier`, so it needs `migrations/0003_lifecycle.sql` applied first.
Missing game content never blocks the seed.

```bash
.venv/bin/python -I seed.py en
.venv/bin/python -I seed.py fr
for f in data/seed/en-*.sql data/seed/fr-*.sql; do
  npx wrangler d1 execute vocabulary-app --remote --file "pipeline/$f"   # from the repo root
done
```

The chunks hold 2,500 rows each as upserts on `id` (language base + rank, per
`migrations/0001_init.sql`), so reloading is safe. If a newer list is shorter than the one already
loaded, rows past its last rank stay in the table. `data/seed/<lang>-words.jsonl.gz` is the final
enriched list, to attach to a GitHub release so the seed can be rebuilt without paying for
enrichment again.

## Data licenses

| Source | License | Used for |
|---|---|---|
| [wordfreq](https://github.com/rspeer/wordfreq) 3.1 (Speer 2022) | data CC BY-SA 4.0 (code Apache 2.0) | English frequencies |
| [Open English WordNet 2024](https://en-word.net/) | CC BY 4.0 | English lemmatization and glosses |
| [Lexique 3.83](http://www.lexique.org/) (New, Pallier et al.) | CC BY-SA 4.0 | French lemmas, POS and frequencies |
| [Wiktionary](https://www.wiktionary.org/) via [kaikki.org](https://kaikki.org/) / wiktextract (Ylonen 2022) | CC BY-SA 4.0 and GFDL | English lemmas, inflections and glosses OEWN lacks; French glosses (fr.wiktionary); English glosses for French (en.wiktionary) |
| [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) | CC BY 4.0 | profanity drop lists |

The seed contains Wiktionary and Lexique text, so the seed and the release JSONL are CC BY-SA 4.0
and need attribution to Wiktionary contributors, Lexique, Open English WordNet and wordfreq (the app footer
carries it). Definitions, distractors, examples and game content are written by Claude.
