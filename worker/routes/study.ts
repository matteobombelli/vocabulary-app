import {
  StudyAnswer,
  type GameKind,
  type PairWord,
  type SessionWord,
  type StudyAnswerResponse,
  type StudySession,
  type WordListItem,
  type WordListTab,
} from "../../shared/api";
import { ADAPT_STEP, ADAPT_WINDOW, adaptiveMove, tiersFor } from "../../shared/levels";
import { advance, newWordState, servedStage, type Stage, type WordState } from "../../shared/lifecycle";
import { requireUser } from "../auth/session";
import {
  WORD_COLUMNS,
  definitionIn,
  definitionOptions,
  gamesOf,
  getCourse,
  getWord,
  glossesIn,
  parseLang,
  type CourseRow,
  type WordRow,
} from "../db";
import { json, now, parseJson } from "../http";
import { HttpError, type Router } from "../router";
import { evaluate } from "../services/answer";
import { gradingStatus } from "../services/budget";

// A session: up to SESSION_WORDS words, decayed known words and words in progress first, then up
// to NEW_WORDS new ones.
const SESSION_WORDS = 10;
const NEW_WORDS = 5;
const DECAYED_WORDS = 4;
// Known words sent along to fill synonym and antonym boards.
const PAIR_WORDS = 12;
const PAIR_SCAN = 40;
const WORDS_PAGE = 50;

const USER_WORD_COLUMNS = "uw.status, uw.completions, uw.games_needed, uw.games_done, uw.due_at, uw.fail_count, uw.failed_at";

interface UserWordRow {
  status: Stage;
  completions: number | null;
  games_needed: number;
  games_done: number;
  due_at: number | null;
  fail_count: number;
  failed_at: number | null;
}

function toState(row: UserWordRow): WordState {
  return {
    stage: row.status,
    gamesNeeded: row.games_needed,
    gamesDone: row.games_done,
    completions: row.completions,
    dueAt: row.due_at,
    failCount: row.fail_count,
    failedAt: row.failed_at,
  };
}

function requireStarted(course: CourseRow): void {
  if (course.start_rank === null) throw new HttpError(409, "Take the assessment first");
}

// What each stage takes. Only match boards are judged on the client; everything that can finish
// a word (the intro and the define stage) is checked here.
const GAME_ANSWERS: Record<StudyAnswer["kind"], GameKind[]> = {
  match: ["synonym", "antonym"],
  choice: ["usage", "cloze", "mc"],
  typed: ["cloze", "sentence"],
  dontknow: ["usage", "cloze", "mc", "sentence"],
};

/** Whether an answer is one the stage could have shown (define multiple choice only while grading is paused). */
async function fits(body: StudyAnswer, stage: Stage, choiceOnly: () => Promise<boolean>): Promise<boolean> {
  switch (stage) {
    case "intro":
      return body.game === "mc" && (body.kind === "choice" || body.kind === "dontknow");
    case "games":
      return GAME_ANSWERS[body.kind].includes(body.game);
    case "define":
      if (body.game !== "define") return false;
      if (body.kind === "typed" || body.kind === "dontknow") return true;
      return body.kind === "choice" && (await choiceOnly());
    case "known":
      return false;
  }
}

/** An answer for a state the word has moved past: a retry, a replay, or a define not yet due. */
function stale(body: StudyAnswer, state: WordState, served: Stage, t: number): boolean {
  if (body.stage !== served) return true;
  if (served === "define" && state.stage === "define" && state.dueAt !== null && state.dueAt > t) return true;
  return served === "games" && body.gamesDone !== undefined && body.gamesDone !== state.gamesDone;
}

/** The new-word cursor after an adaptive move up, or null when no word of the level's tiers is left above it. */
async function cursorUp(db: D1Database, course: CourseRow): Promise<number | null> {
  const cursor = course.cursor_rank + ADAPT_STEP;
  const tiers = tiersFor(course.level);
  const next = await db
    .prepare(`SELECT 1 FROM words WHERE lang = ? AND tier IN (${tiers.map(() => "?").join(", ")}) AND rank > ? LIMIT 1`)
    .bind(course.lang, ...tiers, cursor)
    .first();
  return next ? cursor : null;
}

function sessionWord(w: WordRow, course: CourseRow, state: WordState, isNew: boolean, t: number): SessionWord {
  return {
    wordId: w.id,
    lemma: w.lemma,
    pos: w.pos,
    rank: w.rank,
    stage: servedStage(state, t),
    isNew,
    decayed: state.stage === "known",
    gamesNeeded: state.gamesNeeded,
    gamesDone: state.gamesDone,
    failCount: state.failCount,
    options: definitionOptions(w, course.def_lang),
    definition: definitionIn(w, course.def_lang),
    glosses: glossesIn(w, course.def_lang),
    example: w.example,
    games: gamesOf(w),
  };
}

/**
 * The next new words at the learner's level: one index range per tier, merged by rank. Moves
 * cursor_rank up to just before the first of them, so later scans skip the words already seen.
 */
async function newWords(db: D1Database, course: CourseRow, limit: number): Promise<WordRow[]> {
  if (limit <= 0) return [];
  const query = db.prepare(
    `SELECT ${WORD_COLUMNS} FROM words w WHERE w.lang = ? AND w.tier = ? AND w.rank > ?
     AND NOT EXISTS (SELECT 1 FROM user_words uw WHERE uw.user_id = ? AND uw.word_id = w.id)
     ORDER BY w.rank LIMIT ?`,
  );
  const batches = await db.batch<WordRow>(
    tiersFor(course.level).map((tier) => query.bind(course.lang, tier, course.cursor_rank, course.user_id, limit)),
  );
  const words = batches
    .flatMap((b) => b.results)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
  if (words.length > 0 && words[0].rank - 1 > course.cursor_rank) {
    await db
      .prepare("UPDATE courses SET cursor_rank = ? WHERE user_id = ? AND lang = ? AND cursor_rank < ?")
      .bind(words[0].rank - 1, course.user_id, course.lang, words[0].rank - 1)
      .run();
  }
  return words;
}

/** Words the learner knows, with synonyms or antonyms: their own known words, else commoner core words. */
async function pairWords(db: D1Database, course: CourseRow, exclude: Set<number>): Promise<PairWord[]> {
  const { results: known } = await db
    .prepare(
      `SELECT w.id, w.lemma, w.games FROM user_words uw JOIN words w ON w.id = uw.word_id
       WHERE uw.user_id = ? AND uw.lang = ? AND uw.status = 'known' ORDER BY uw.updated_at DESC LIMIT ?`,
    )
    .bind(course.user_id, course.lang, PAIR_SCAN)
    .all<{ id: number; lemma: string; games: string }>();
  let rows = known;
  if (rows.length < PAIR_SCAN && course.cursor_rank > 0) {
    // Words before where learning starts are assumed known.
    const { results: common } = await db
      .prepare(`SELECT w.id, w.lemma, w.games FROM words w WHERE w.lang = ? AND w.tier = 3 AND w.rank <= ? ORDER BY w.rank DESC LIMIT ?`)
      .bind(course.lang, course.cursor_rank, PAIR_SCAN)
      .all<{ id: number; lemma: string; games: string }>();
    rows = [...rows, ...common];
  }
  const out: PairWord[] = [];
  for (const r of rows) {
    if (out.length >= PAIR_WORDS || exclude.has(r.id) || out.some((p) => p.wordId === r.id)) continue;
    const { synonyms, antonyms } = gamesOf(r);
    if (synonyms.length > 0 || antonyms.length > 0) out.push({ wordId: r.id, lemma: r.lemma, synonyms, antonyms });
  }
  return out;
}

export function registerStudyRoutes(r: Router): void {
  r.get("/courses/:lang/session", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    requireStarted(course);
    const t = now();
    const withState = `SELECT ${WORD_COLUMNS}, ${USER_WORD_COLUMNS} FROM user_words uw JOIN words w ON w.id = uw.word_id`;
    const [{ results: decayed }, { results: inProgress }] = await c.env.DB.batch<WordRow & UserWordRow>([
      c.env.DB.prepare(`${withState} WHERE uw.user_id = ? AND uw.lang = ? AND uw.status = 'known' AND uw.due_at <= ? ORDER BY uw.due_at LIMIT ?`).bind(
        user.id,
        course.lang,
        t,
        DECAYED_WORDS,
      ),
      c.env.DB.prepare(
        `${withState} WHERE uw.user_id = ? AND uw.lang = ? AND uw.status IN ('intro', 'games', 'define') AND uw.due_at <= ?
         ORDER BY uw.due_at LIMIT ?`,
      ).bind(user.id, course.lang, t, SESSION_WORDS),
    ]);
    const started = [...decayed, ...inProgress].slice(0, SESSION_WORDS);
    const fresh = await newWords(c.env.DB, course, Math.min(NEW_WORDS, SESSION_WORDS - started.length));
    const words = [
      ...started.map((w) => sessionWord(w, course, toState(w), false, t)),
      ...fresh.map((w) => sessionWord(w, course, newWordState(t), true, t)),
    ];
    const [known, status] = await Promise.all([
      pairWords(c.env.DB, course, new Set(words.map((w) => w.wordId))),
      gradingStatus(c.env, user.id),
    ]);
    const session: StudySession = { level: course.level, words, known, status };
    return json({ session });
  });

  r.post("/courses/:lang/answer", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const body = await parseJson(c.req, StudyAnswer);
    const word = await getWord(c.env.DB, body.wordId, course.lang);
    const row = await c.env.DB.prepare(`SELECT ${USER_WORD_COLUMNS} FROM user_words uw WHERE uw.user_id = ? AND uw.word_id = ?`)
      .bind(user.id, word.id)
      .first<UserWordRow>();
    const t = now();
    const state = row ? toState(row) : newWordState(t);
    const served = servedStage(state, t);
    const graded = body.kind === "typed" && body.game !== "cloze";
    // A stale answer is logged, nothing more; one that needs the grader is refused, so it costs nothing.
    if (stale(body, state, served, t)) {
      if (graded) throw new HttpError(422, "This word has moved on");
      return json({ result: await evaluate(c.env, course, word, body, "learn"), levelChange: null } satisfies StudyAnswerResponse);
    }
    if (!(await fits(body, served, async () => (await gradingStatus(c.env, user.id)).choiceOnly))) {
      throw new HttpError(400, "That answer does not fit the word's stage");
    }
    const result = await evaluate(c.env, course, word, body, "learn");
    const response: StudyAnswerResponse = { result, levelChange: null };

    const correct = result.verdict === "correct";
    const firstSight = row === null;
    const next = advance(state, served, correct, t, firstSight);
    const writes = [
      c.env.DB.prepare(
        `INSERT INTO user_words (user_id, word_id, lang, status, completions, games_needed, games_done, due_at, fail_count, failed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, word_id) DO UPDATE SET status = excluded.status, completions = excluded.completions,
           games_needed = excluded.games_needed, games_done = excluded.games_done, due_at = excluded.due_at,
           fail_count = excluded.fail_count, failed_at = excluded.failed_at, updated_at = excluded.updated_at`,
      ).bind(
        user.id,
        word.id,
        course.lang,
        next.stage,
        next.completions,
        next.gamesNeeded,
        next.gamesDone,
        next.dueAt,
        next.failCount,
        next.failedAt,
        t,
        t,
      ),
    ];

    // Adaptive placement counts first-sight answers on new words.
    if (firstSight) {
      const right = course.adapt_right + (correct ? 1 : 0);
      const total = course.adapt_total + 1;
      let move = adaptiveMove(right, total);
      let cursor = course.cursor_rank;
      if (move === "down") cursor = Math.max(0, cursor - ADAPT_STEP);
      if (move === "up") {
        // No move past the last word the level teaches: new words would stop for good.
        const up = await cursorUp(c.env.DB, course);
        if (up === null) move = null;
        else cursor = up;
      }
      response.levelChange = move;
      const reset = total >= ADAPT_WINDOW;
      writes.push(
        c.env.DB.prepare("UPDATE courses SET cursor_rank = ?, adapt_right = ?, adapt_total = ? WHERE user_id = ? AND lang = ?").bind(
          cursor,
          reset ? 0 : right,
          reset ? 0 : total,
          user.id,
          course.lang,
        ),
      );
    }
    await c.env.DB.batch(writes);
    return json(response);
  });

  r.get("/courses/:lang/words", async (c) => {
    const user = await requireUser(c);
    const course = await getCourse(c.env.DB, user.id, parseLang(c.params.lang));
    const param = c.url.searchParams.get("status");
    const tab: WordListTab = param === "learning" || param === "recovered" ? param : "known";
    const offset = Math.max(0, Number(c.url.searchParams.get("offset")) || 0);
    const t = now();
    const filter = {
      learning: "(uw.status != 'known' OR uw.due_at <= ?1)",
      known: "uw.status = 'known' AND (uw.due_at IS NULL OR uw.due_at > ?1)",
      recovered: "uw.status = 'known' AND uw.failed_at IS NOT NULL",
    }[tab];
    const order = tab === "recovered" ? "uw.updated_at DESC" : "w.rank";
    const { results } = await c.env.DB.prepare(
      `SELECT ${WORD_COLUMNS}, ${USER_WORD_COLUMNS} FROM user_words uw JOIN words w ON w.id = uw.word_id
       WHERE uw.user_id = ?2 AND uw.lang = ?3 AND ${filter} ORDER BY ${order} LIMIT ?4 OFFSET ?5`,
    )
      .bind(t, user.id, course.lang, WORDS_PAGE + 1, offset)
      .all<WordRow & UserWordRow>();
    const words: WordListItem[] = results.slice(0, WORDS_PAGE).map((w) => {
      const stage = servedStage(toState(w), t);
      return {
        wordId: w.id,
        lemma: w.lemma,
        rank: w.rank,
        stage,
        decayed: w.status === "known" && stage === "define",
        gamesDone: w.games_done,
        gamesNeeded: w.games_needed,
        dueAt: w.due_at,
        failCount: w.fail_count,
        definition: definitionIn(w, course.def_lang),
      };
    });
    return json({ words, hasMore: results.length > WORDS_PAGE });
  });
}
