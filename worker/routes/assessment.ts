import { Answer, type AssessmentAnswerResponse, type AssessmentStep, type Lang } from "../../shared/api";
import {
  ASSESSMENT_ITEMS,
  bandRange,
  estimateSize,
  fit,
  initialState,
  isDone,
  itemKind,
  nextBand,
  record,
  startRank,
  type AssessmentState,
} from "../../shared/assessment";
import { newId } from "../../shared/ids";
import { requireUser } from "../auth/session";
import { WORD_COLUMNS, getCourse, getWord, parseLang, toCard, totalWords, type CourseRow, type WordRow } from "../db";
import { json, now, parseJson } from "../http";
import { HttpError, type Router } from "../router";
import { gradingStatus } from "../services/budget";
import { evaluate } from "../services/answer";

const SCORES = { correct: 1, partial: 0.5, incorrect: 0 } as const;

interface AssessmentRow {
  id: string;
  state: string;
}

/**
 * An eligible word from the band the state asks for, not asked before: the first one at or after
 * a random rank in the band (an index seek), wrapping to the band's start.
 */
async function pickWord(db: D1Database, lang: Lang, state: AssessmentState): Promise<WordRow> {
  const [lo, hi] = bandRange(nextBand(state), state.maxRank);
  const seek = db.prepare(
    `SELECT ${WORD_COLUMNS} FROM words w WHERE w.lang = ? AND w.eligible = 1 AND w.rank >= ? AND w.rank <= ? ORDER BY w.rank LIMIT 8`,
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    const from = attempt === 3 ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));
    const { results } = await seek.bind(lang, from, hi).all<WordRow>();
    const word = results.find((w) => !state.asked.includes(w.id));
    if (word) return word;
  }
  // The band is used up: any eligible word not asked yet.
  const { results } = await db
    .prepare(`SELECT ${WORD_COLUMNS} FROM words w WHERE w.lang = ? AND w.eligible = 1 ORDER BY w.rank LIMIT ?`)
    .bind(lang, state.asked.length + 1)
    .all<WordRow>();
  const word = results.find((w) => !state.asked.includes(w.id));
  if (!word) throw new HttpError(409, "Not enough words for an assessment");
  return word;
}

async function nextStep(env: Env, course: CourseRow, id: string, state: AssessmentState): Promise<[AssessmentState, AssessmentStep]> {
  const word = await pickWord(env.DB, course.lang, state);
  const { choiceOnly } = await gradingStatus(env, course.user_id);
  const kind = itemKind(state.responses.length, choiceOnly);
  const next = { ...state, asked: [...state.asked, word.id], pending: { wordId: word.id, rank: word.rank, kind } };
  return [next, { assessmentId: id, index: state.responses.length, total: ASSESSMENT_ITEMS, card: toCard(word, course.def_lang, kind, false) }];
}

export function registerAssessmentRoutes(r: Router): void {
  r.post("/courses/:lang/assessment", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const maxRank = await totalWords(c.env.DB, course.lang);
    if (maxRank === 0) throw new HttpError(409, "No words loaded for this language yet");
    const id = newId();
    const [state, step] = await nextStep(c.env, course, id, initialState(maxRank));
    await c.env.DB.prepare("INSERT INTO assessments (id, user_id, lang, state, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, user.id, course.lang, JSON.stringify(state), now())
      .run();
    return json({ step }, 201);
  });

  r.post("/courses/:lang/assessment/:id/answer", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const body = await parseJson(c.req, Answer);
    const row = await c.env.DB.prepare(
      "SELECT id, state FROM assessments WHERE id = ? AND user_id = ? AND lang = ? AND finished_at IS NULL",
    )
      .bind(c.params.id, user.id, course.lang)
      .first<AssessmentRow>();
    if (!row) throw new HttpError(404, "Not found");
    const state = JSON.parse(row.state) as AssessmentState;
    const pending = state.pending;
    if (!pending || pending.wordId !== body.wordId) throw new HttpError(409, "That word is not the current question");
    if (body.kind !== "dontknow" && body.kind !== pending.kind) throw new HttpError(400, "Wrong answer kind for this question");

    const word = await getWord(c.env.DB, body.wordId, course.lang);
    const result = await evaluate(c.env, course, word, body, "assessment");
    let updated = record(state, SCORES[result.verdict]);
    const t = now();
    if (result.verdict === "correct") {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO user_words (user_id, word_id, lang, status, box, due_at, created_at, updated_at) VALUES (?, ?, ?, 'known', NULL, NULL, ?, ?)",
      )
        .bind(user.id, word.id, course.lang, t, t)
        .run();
    }

    const response: AssessmentAnswerResponse = { result, next: null, outcome: null };
    if (isDone(updated)) {
      const f = fit(updated.responses, updated.maxRank);
      const estSize = estimateSize(f, updated.maxRank);
      const start = startRank(f, updated.maxRank);
      response.outcome = { estSize, startRank: start, totalWords: updated.maxRank };
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE assessments SET state = ?, a = ?, b = ?, est_size = ?, start_rank = ?, finished_at = ? WHERE id = ? AND state = ?",
        ).bind(JSON.stringify(updated), f.a, f.b, estSize, start, t, row.id, row.state),
        c.env.DB.prepare(
          "UPDATE courses SET start_rank = ?, est_size = ?, assessed_at = ?, cursor_rank = 0 WHERE user_id = ? AND lang = ?",
        ).bind(start, estSize, t, user.id, course.lang),
      ]);
    } else {
      [updated, response.next] = await nextStep(c.env, course, row.id, updated);
      // Guarded on the state read above, so a double submit cannot record the same item twice.
      const res = await c.env.DB.prepare("UPDATE assessments SET state = ? WHERE id = ? AND state = ?")
        .bind(JSON.stringify(updated), row.id, row.state)
        .run();
      if (res.meta.changes === 0) throw new HttpError(409, "That word is not the current question");
    }
    return json(response);
  });
}
