// Synthetic words for tests and local development until the real seed (pipeline/) is loaded.
// Each lemma is a made-up word built from its rank, and its right definition is the only text
// containing "<lemma>ness", so the stub grader (GRADER_MODE=stub) can tell answers apart. Game
// content follows the same pattern: synonym "<lemma>syn", antonym "<lemma>ant" (even ranks only),
// the blank filled by the lemma itself, and a right usage sentence starting "Right:".

import type { GameContent, Lang } from "../../shared/api";

const SYLLABLES = ["ba", "ko", "ti", "ru", "me", "sa", "lo", "pe", "du", "vi"];
export const LANG_BASE: Record<Lang, number> = { en: 1_000_000, fr: 2_000_000 };

export interface FixtureWord {
  id: number;
  lang: Lang;
  lemma: string;
  rank: number;
  pos: string;
  glosses: string;
  definition: string;
  distractors: string;
  example: string;
  usefulness: number;
  flags: string;
  eligible: number;
  band: number;
  source_model: string;
  games: string;
  tier: number;
}

export function lemmaFor(lang: Lang, rank: number): string {
  let s = lang === "en" ? "z" : "x";
  for (let n = rank; n > 0; n = Math.floor(n / 10)) s += SYLLABLES[n % 10];
  return s;
}

export function fixtureWords(lang: Lang, count: number): FixtureWord[] {
  return Array.from({ length: count }, (_, i) => {
    const rank = i + 1;
    const lemma = lemmaFor(lang, rank);
    const byLang = (f: (l: Lang) => unknown) => JSON.stringify(lang === "en" ? { en: f("en") } : { fr: f("fr"), en: f("en") });
    return {
      id: LANG_BASE[lang] + rank,
      lang,
      lemma,
      rank,
      pos: "noun",
      glosses: byLang((l) => [`${lemma}ness (${l})`]),
      definition: byLang((l) => `${lemma}ness (${l})`),
      distractors: byLang((l) => [`${lemma}ity (${l})`, `${lemma}ment (${l})`, `${lemma}hood (${l})`]),
      example: `An example sentence with ${lemma}.`,
      // Every seventh word is "general" (tier 2), so a beginner (core words only) skips it.
      usefulness: rank % 7 === 0 ? 3 : 4,
      flags: "[]",
      // Every tenth word is filtered out of learning, as the real seed's ineligible words are.
      eligible: rank % 10 === 0 ? 0 : 1,
      band: Math.floor((rank - 1) / 2500),
      source_model: "fixture",
      games: JSON.stringify(fixtureGames(lemma, rank)),
      tier: rank % 10 === 0 ? 0 : rank % 7 === 0 ? 2 : 3,
    };
  });
}

export function fixtureGames(lemma: string, rank: number): GameContent {
  return {
    synonyms: [`${lemma}syn`],
    antonyms: rank % 2 === 0 ? [`${lemma}ant`] : [],
    cloze: { sentence: `They found the ___ near gate ${rank}.`, answer: lemma, bank: [`${lemma}a`, `${lemma}e`, `${lemma}o`] },
    usage: {
      correct: `Right: the ${lemma} was where it belonged.`,
      wrong: [`Wrong: she ${lemma} the door.`, `Wrong: very ${lemma} of him.`, `Wrong: they ${lemma}ed away.`],
    },
  };
}

const COLUMNS = [
  "id", "lang", "lemma", "rank", "pos", "glosses", "definition", "distractors", "example",
  "usefulness", "flags", "eligible", "band", "source_model", "games", "tier",
] as const;

export const INSERT_WORD = `INSERT INTO words (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;

export function wordValues(w: FixtureWord): (string | number)[] {
  return COLUMNS.map((c) => w[c]);
}

const sqlValue = (v: string | number) => (typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

export function insertSql(words: FixtureWord[]): string {
  return words.map((w) => `INSERT OR REPLACE INTO words (${COLUMNS.join(", ")}) VALUES (${wordValues(w).map(sqlValue).join(", ")});`).join("\n");
}
