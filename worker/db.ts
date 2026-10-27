import { DEF_LANGS, type AnswerLang, type Card, type Course, type GameContent, type Lang, type Level } from "../shared/api";
import { shuffle } from "../shared/session";
import { now } from "./http";
import { HttpError } from "./router";

export interface WordRow {
  id: number;
  lang: Lang;
  lemma: string;
  rank: number;
  pos: string;
  glosses: string;
  definition: string;
  distractors: string;
  example: string;
  games: string;
}

export const WORD_COLUMNS = "w.id, w.lang, w.lemma, w.rank, w.pos, w.glosses, w.definition, w.distractors, w.example, w.games";

export interface CourseRow {
  user_id: string;
  lang: Lang;
  def_lang: Lang;
  answer_lang: AnswerLang;
  start_rank: number | null;
  est_size: number | null;
  cursor_rank: number;
  assessed_at: number | null;
  level: Level | null;
  adapt_right: number;
  adapt_total: number;
}

type ByLang<T> = Partial<Record<Lang, T>>;

/** A per-language field in the course's definition language, falling back to any language present. */
function pick<T>(byLang: ByLang<T>, lang: Lang): T | undefined {
  return byLang[lang] ?? Object.values(byLang)[0];
}

export function definitionIn(word: WordRow, lang: Lang): string {
  return pick(JSON.parse(word.definition) as ByLang<string>, lang) ?? "";
}

export function glossesIn(word: WordRow, lang: Lang): string[] {
  return pick(JSON.parse(word.glosses) as ByLang<string[]>, lang) ?? [];
}

function distractorsIn(word: WordRow, lang: Lang): string[] {
  return pick(JSON.parse(word.distractors) as ByLang<string[]>, lang) ?? [];
}

/** The definition and its distractors, shuffled: the options of a definition multiple choice. */
export function definitionOptions(word: WordRow, lang: Lang): string[] {
  return shuffle([definitionIn(word, lang), ...distractorsIn(word, lang)]);
}

/** A word's game content; anything the pipeline has not written yet is empty. */
export function gamesOf(word: Pick<WordRow, "games">): GameContent {
  const g = JSON.parse(word.games) as Partial<GameContent>;
  return { synonyms: g.synonyms ?? [], antonyms: g.antonyms ?? [], cloze: g.cloze ?? null, usage: g.usage ?? null };
}

export function toCard(word: WordRow, defLang: Lang, kind: Card["kind"], isNew: boolean): Card {
  const card: Card = { wordId: word.id, lemma: word.lemma, pos: word.pos, kind, isNew };
  if (kind === "choice") card.options = definitionOptions(word, defLang);
  return card;
}

export function parseLang(value: string): Lang {
  if (value !== "en" && value !== "fr") throw new HttpError(404, "Not found");
  return value;
}

/** The user's course in a language, created with default settings on first use. */
export async function getCourse(db: D1Database, userId: string, lang: Lang): Promise<CourseRow> {
  const defLang = DEF_LANGS[lang][0];
  await db
    .prepare("INSERT OR IGNORE INTO courses (user_id, lang, def_lang, answer_lang, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, lang, defLang, defLang, now())
    .run();
  return (await db
    .prepare(
      `SELECT user_id, lang, def_lang, answer_lang, start_rank, est_size, cursor_rank, assessed_at, level, adapt_right, adapt_total
       FROM courses WHERE user_id = ? AND lang = ?`,
    )
    .bind(userId, lang)
    .first<CourseRow>())!;
}

export async function getWord(db: D1Database, id: number, lang: Lang): Promise<WordRow> {
  const word = await db
    .prepare(`SELECT ${WORD_COLUMNS} FROM words w WHERE w.id = ? AND w.lang = ?`)
    .bind(id, lang)
    .first<WordRow>();
  if (!word) throw new HttpError(404, "Not found");
  return word;
}

/** The highest rank in a language's list: its length, since ranks run 1..n. */
export async function totalWords(db: D1Database, lang: Lang): Promise<number> {
  const row = await db.prepare("SELECT MAX(rank) AS n FROM words WHERE lang = ?").bind(lang).first<{ n: number | null }>();
  return row?.n ?? 0;
}

export async function toCourse(db: D1Database, row: CourseRow): Promise<Course> {
  const t = now();
  const [counts, due, recovered, total] = await Promise.all([
    db
      .prepare("SELECT status, COUNT(*) AS n FROM user_words WHERE user_id = ? AND lang = ? GROUP BY status")
      .bind(row.user_id, row.lang)
      .all<{ status: string; n: number }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM user_words WHERE user_id = ? AND lang = ? AND status = 'known' AND due_at <= ?")
      .bind(row.user_id, row.lang, t)
      .first<{ n: number }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM user_words WHERE user_id = ? AND lang = ? AND status = 'known' AND failed_at IS NOT NULL")
      .bind(row.user_id, row.lang)
      .first<{ n: number }>(),
    totalWords(db, row.lang),
  ]);
  const known = counts.results.find((r) => r.status === "known")?.n ?? 0;
  const all = counts.results.reduce((s, r) => s + r.n, 0);
  return {
    lang: row.lang,
    defLang: row.def_lang,
    answerLang: row.answer_lang,
    level: row.level,
    startRank: row.start_rank,
    estSize: row.est_size,
    assessedAt: row.assessed_at,
    totalWords: total,
    known,
    learning: all - known,
    recovered: recovered?.n ?? 0,
    due: due?.n ?? 0,
  };
}
