import { StudyAnswer, type Card, type WordListItem } from "../../shared/api";
import { schedule } from "../../shared/leitner";
import { requireUser } from "../auth/session";
import { WORD_COLUMNS, definitionIn, getCourse, getWord, parseLang, toCard, type CourseRow, type WordRow } from "../db";
import { json, now, parseJson } from "../http";
import { HttpError, type Router } from "../router";
import { evaluate } from "../services/answer";
import { gradingStatus } from "../services/budget";

const LEARN_BATCH = 10;
const REVIEW_BATCH = 20;
const WORDS_PAGE = 50;

function requireStarted(course: CourseRow): number {
  if (course.start_rank === null) throw new HttpError(409, "Take the assessment first");
  return course.start_rank;
}

async function cardKind(env: Env, userId: string): Promise<Card["kind"]> {
  return (await gradingStatus(env, userId)).choiceOnly ? "choice" : "typed";
}

export function registerStudyRoutes(r: Router): void {
  // Failed words that are due come first, then new words in rank order from where the user is.
  r.get("/courses/:lang/learn", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const start = requireStarted(course);
    const t = now();
    const { results: learning } = await c.env.DB.prepare(
      `SELECT ${WORD_COLUMNS} FROM user_words uw JOIN words w ON w.id = uw.word_id
       WHERE uw.user_id = ? AND uw.lang = ? AND uw.status = 'learning' AND uw.due_at <= ? ORDER BY uw.due_at LIMIT ?`,
    )
      .bind(user.id, course.lang, t, LEARN_BATCH)
      .all<WordRow>();
    let fresh: WordRow[] = [];
    if (learning.length < LEARN_BATCH) {
      ({ results: fresh } = await c.env.DB.prepare(
        `SELECT ${WORD_COLUMNS} FROM words w WHERE w.lang = ? AND w.eligible = 1 AND w.rank > ?
         AND NOT EXISTS (SELECT 1 FROM user_words uw WHERE uw.user_id = ? AND uw.word_id = w.id)
         ORDER BY w.rank LIMIT ?`,
      )
        .bind(course.lang, Math.max(course.cursor_rank, start - 1), user.id, LEARN_BATCH - learning.length)
        .all<WordRow>());
    }
    const kind = await cardKind(c.env, user.id);
    const cards = [
      ...learning.map((w) => toCard(w, course.def_lang, kind, false)),
      ...fresh.map((w) => toCard(w, course.def_lang, kind, true)),
    ];
    return json({ cards });
  });

  r.get("/courses/:lang/review", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const { results } = await c.env.DB.prepare(
      `SELECT ${WORD_COLUMNS} FROM user_words uw JOIN words w ON w.id = uw.word_id
       WHERE uw.user_id = ? AND uw.lang = ? AND uw.status = 'known' AND uw.due_at <= ? ORDER BY uw.due_at LIMIT ?`,
    )
      .bind(user.id, course.lang, now(), REVIEW_BATCH)
      .all<WordRow>();
    const kind = await cardKind(c.env, user.id);
    return json({ cards: results.map((w) => toCard(w, course.def_lang, kind, false)) });
  });

  r.post("/courses/:lang/answer", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const body = await parseJson(c.req, StudyAnswer);
    const word = await getWord(c.env.DB, body.wordId, course.lang);
    const result = await evaluate(c.env, course, word, body, body.mode);
    if (body.retry) return json({ result });

    const existing = await c.env.DB.prepare("SELECT box FROM user_words WHERE user_id = ? AND word_id = ?")
      .bind(user.id, word.id)
      .first<{ box: number | null }>();
    const correct = result.verdict === "correct";
    const t = now();
    const next = schedule(existing?.box ?? null, correct, t);
    const writes = [
      c.env.DB.prepare(
        `INSERT INTO user_words (user_id, word_id, lang, status, box, due_at, fail_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, word_id) DO UPDATE SET status = excluded.status, box = excluded.box,
           due_at = excluded.due_at, fail_count = fail_count + excluded.fail_count, updated_at = excluded.updated_at`,
      ).bind(user.id, word.id, course.lang, next.status, next.box, next.dueAt, correct ? 0 : 1, t, t),
    ];
    if (body.mode === "learn" && word.rank > course.cursor_rank) {
      writes.push(
        c.env.DB.prepare("UPDATE courses SET cursor_rank = ? WHERE user_id = ? AND lang = ? AND cursor_rank < ?").bind(
          word.rank,
          user.id,
          course.lang,
          word.rank,
        ),
      );
    }
    await c.env.DB.batch(writes);
    return json({ result });
  });

  r.get("/courses/:lang/words", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const status = c.url.searchParams.get("status") === "learning" ? "learning" : "known";
    const offset = Math.max(0, Number(c.url.searchParams.get("offset")) || 0);
    const { results } = await c.env.DB.prepare(
      `SELECT ${WORD_COLUMNS}, uw.status, uw.box, uw.due_at FROM user_words uw JOIN words w ON w.id = uw.word_id
       WHERE uw.user_id = ? AND uw.lang = ? AND uw.status = ? ORDER BY w.rank LIMIT ? OFFSET ?`,
    )
      .bind(user.id, course.lang, status, WORDS_PAGE + 1, offset)
      .all<WordRow & { status: "known" | "learning"; box: number | null; due_at: number | null }>();
    const words: WordListItem[] = results.slice(0, WORDS_PAGE).map((w) => ({
      wordId: w.id,
      lemma: w.lemma,
      rank: w.rank,
      status: w.status,
      box: w.box,
      dueAt: w.due_at,
      definition: definitionIn(w, course.def_lang),
    }));
    return json({ words, hasMore: results.length > WORDS_PAGE });
  });
}
