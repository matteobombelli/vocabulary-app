import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { Level, StudyAnswer, StudyAnswerResponse, StudySession, WordListItem } from "../../shared/api";
import { ADAPT_STEP, ADAPT_WINDOW } from "../../shared/levels";
import { DEFINE_DELAY_MS } from "../../shared/lifecycle";
import { fixtureGames } from "../fixtures/words";
import { cookieHeader, jsonRequest, registerAndLogin, request, rightAnswer, seedWords, wordId } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const email = () => `study${++seq}@example.com`;

beforeAll(async () => {
  await seedWords("en", 6000);
  await seedWords("fr", 200);
});

async function started(lang = "en", level: Level = "fluent") {
  const session = await registerAndLogin(email());
  await jsonRequest(`/courses/${lang}/level`, "PUT", { level }, session.cookie);
  await request(`/courses/${lang}/start-from-beginning`, { method: "POST", headers: cookieHeader(session.cookie) });
  return session;
}

async function getSession(cookie: string, lang = "en"): Promise<StudySession> {
  const res = await request(`/courses/${lang}/session`, { headers: cookieHeader(cookie) });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { session: StudySession }).session;
}

async function answer(cookie: string, body: StudyAnswer, lang = "en"): Promise<StudyAnswerResponse> {
  const res = await jsonRequest(`/courses/${lang}/answer`, "POST", body, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as StudyAnswerResponse;
}

const lemmaOf = (rank: number) => {
  const syllables = ["ba", "ko", "ti", "ru", "me", "sa", "lo", "pe", "du", "vi"];
  let s = "z";
  for (let n = rank; n > 0; n = Math.floor(n / 10)) s += syllables[n % 10];
  return s;
};

const intro = (id: number, correct: boolean): StudyAnswer => ({
  wordId: id,
  stage: "intro",
  game: "mc",
  kind: correct ? "choice" : "dontknow",
  answer: correct ? rightAnswer(lemmaOf(id - 1_000_000)) : undefined,
});
const game = (id: number, correct: boolean): StudyAnswer => ({ wordId: id, stage: "games", game: "synonym", kind: "match", correct });
const define = (id: number, correct: boolean): StudyAnswer => ({
  wordId: id,
  stage: "define",
  game: "define",
  kind: correct ? "typed" : "dontknow",
  answer: correct ? rightAnswer(lemmaOf(id - 1_000_000)) : undefined,
});

async function userWord(userId: string, id: number) {
  return env.DB.prepare(
    "SELECT status, completions, games_needed, games_done, due_at, fail_count, failed_at FROM user_words WHERE user_id = ? AND word_id = ?",
  )
    .bind(userId, id)
    .first<{
      status: string;
      completions: number | null;
      games_needed: number;
      games_done: number;
      due_at: number | null;
      fail_count: number;
      failed_at: number | null;
    }>();
}

const ago = (userId: string, id: number) =>
  env.DB.prepare("UPDATE user_words SET due_at = ? WHERE user_id = ? AND word_id = ?").bind(Date.now() - 1, userId, id).run();

describe("session", () => {
  it("needs a starting point", async () => {
    const { cookie } = await registerAndLogin(email());
    expect((await request("/courses/en/session", { headers: cookieHeader(cookie) })).status).toBe(409);
  });

  it("serves new words of the level's tiers in rank order, with their games", async () => {
    const { cookie } = await started();
    const s = await getSession(cookie);
    // Rank 10 is ineligible (tier 0); fluent learners get tier 2 (rank 7) too.
    expect(s.words.map((w) => w.rank)).toEqual([1, 2, 3, 4, 5]);
    const w = s.words[0];
    expect(w).toMatchObject({ stage: "intro", isNew: true, decayed: false, definition: rightAnswer(w.lemma), games: fixtureGames(w.lemma, 1) });
    expect(w.options).toHaveLength(4);
    expect(w.options).toContain(rightAnswer(w.lemma));
    expect(s.level).toBe("fluent");
  });

  it("gives beginners core words only", async () => {
    const { cookie, user } = await started("en", "beginner");
    await env.DB.prepare("UPDATE courses SET cursor_rank = 6 WHERE user_id = ?").bind(user.id).run();
    // Rank 7 and 14 are general words (tier 2), rank 10 is never taught.
    expect((await getSession(cookie)).words.map((w) => w.rank)).toEqual([8, 9, 11, 12, 13]);
  });

  it("fills boards with known words", async () => {
    const { cookie, user } = await started();
    expect((await getSession(cookie)).known).toEqual([]);
    const id = wordId("en", 1);
    await answer(cookie, intro(id, true));
    await env.DB.prepare("UPDATE user_words SET status = 'known', due_at = NULL WHERE user_id = ? AND word_id = ?").bind(user.id, id).run();
    const s = await getSession(cookie);
    expect(s.known.map((k) => k.wordId)).toContain(id);
  });
});

describe("lifecycle", () => {
  it("fast-tracks a word right on first sight to one game, then define in a later session", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, true));
    expect(await userWord(user.id, id)).toMatchObject({ status: "games", games_needed: 1, games_done: 0, failed_at: null });

    const before = Date.now();
    await answer(cookie, game(id, true));
    const row = await userWord(user.id, id);
    expect(row).toMatchObject({ status: "define", games_done: 1 });
    expect(row!.due_at).toBeGreaterThanOrEqual(before + DEFINE_DELAY_MS);
    expect((await getSession(cookie)).words.map((w) => w.wordId)).not.toContain(id);

    await ago(user.id, id);
    const s = await getSession(cookie);
    expect(s.words[0]).toMatchObject({ wordId: id, stage: "define", isNew: false, decayed: false });

    await answer(cookie, define(id, true));
    const known = await userWord(user.id, id);
    expect(known).toMatchObject({ status: "known", completions: 1 });
    expect(known!.due_at).toBeGreaterThan(Date.now() + 6.9 * DAY);
  });

  it("needs three games after a miss, and remembers the miss", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, false));
    const missed = await userWord(user.id, id);
    expect(missed).toMatchObject({ status: "intro", fail_count: 1 });
    expect(missed!.failed_at).not.toBeNull();

    await answer(cookie, intro(id, true));
    expect(await userWord(user.id, id)).toMatchObject({ status: "games", games_needed: 3 });
    await answer(cookie, game(id, true));
    await answer(cookie, game(id, false));
    await answer(cookie, game(id, true));
    expect(await userWord(user.id, id)).toMatchObject({ status: "games", games_done: 2, fail_count: 2 });
    await answer(cookie, game(id, true));
    expect(await userWord(user.id, id)).toMatchObject({ status: "define", games_done: 3 });
  });

  it("decays known words back to define at 7, 14, 30 and 90 days, then never", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, true));
    await answer(cookie, game(id, true));
    for (const [completions, days] of [
      [1, 7],
      [2, 14],
      [3, 30],
      [4, 90],
    ]) {
      await ago(user.id, id);
      if (completions > 1) {
        const s = await getSession(cookie);
        expect(s.words[0]).toMatchObject({ wordId: id, stage: "define", decayed: true });
      }
      await answer(cookie, define(id, true));
      const row = await userWord(user.id, id);
      expect(row).toMatchObject({ status: "known", completions });
      expect(row!.due_at! - Date.now()).toBeGreaterThan((days - 0.1) * DAY);
      expect(row!.due_at! - Date.now()).toBeLessThan(days * DAY + 1000);
    }
    await ago(user.id, id);
    await answer(cookie, define(id, true));
    expect(await userWord(user.id, id)).toMatchObject({ status: "known", completions: 5, due_at: null });
  });

  it("keeps a missed decayed word in define", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, true));
    await answer(cookie, game(id, true));
    await ago(user.id, id);
    await answer(cookie, define(id, true));
    await ago(user.id, id);
    await answer(cookie, define(id, false));
    expect(await userWord(user.id, id)).toMatchObject({ status: "define", completions: 1, fail_count: 1 });
  });

  it("refuses answers the stage could not have shown", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    const lemma = lemmaOf(1);
    const refused = async (body: StudyAnswer) => expect((await jsonRequest("/courses/en/answer", "POST", body, cookie)).status).toBe(400);
    await refused({ wordId: id, stage: "intro", game: "synonym", kind: "match", correct: true });
    await answer(cookie, intro(id, true));
    await answer(cookie, game(id, true));
    await ago(user.id, id);
    // A blank answered with the word itself, the definition picked from the session payload, a board.
    await refused({ wordId: id, stage: "define", game: "cloze", kind: "typed", answer: lemma });
    await refused({ wordId: id, stage: "define", game: "define", kind: "choice", answer: rightAnswer(lemma) });
    await refused({ wordId: id, stage: "define", game: "synonym", kind: "match", correct: true });
    expect(await userWord(user.id, id)).toMatchObject({ status: "define" });
  });

  it("does not take a define answer before it is due, and does not grade it", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, true));
    await answer(cookie, game(id, true));
    const res = await jsonRequest("/courses/en/answer", "POST", define(id, true), cookie);
    expect(res.status).toBe(422);
    expect(await userWord(user.id, id)).toMatchObject({ status: "define" });
    const graded = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND graded = 1").bind(user.id).first<{ n: number }>();
    expect(graded!.n).toBe(0);
  });

  it("counts a replayed game answer once", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, false));
    await answer(cookie, intro(id, true));
    await answer(cookie, { ...game(id, true), gamesDone: 0 });
    await answer(cookie, { ...game(id, true), gamesDone: 0 });
    expect(await userWord(user.id, id)).toMatchObject({ status: "games", games_done: 1 });
  });

  it("logs an answer for a stage the word has left without moving it", async () => {
    const { cookie, user } = await started();
    const id = wordId("en", 1);
    await answer(cookie, intro(id, true));
    await answer(cookie, intro(id, true));
    expect(await userWord(user.id, id)).toMatchObject({ status: "games", games_done: 0 });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND word_id = ?").bind(user.id, id).first<{ n: number }>();
    expect(n!.n).toBe(2);
  });
});

describe("games", () => {
  async function inGames() {
    const s = await started();
    const id = wordId("en", 2);
    await answer(s.cookie, intro(id, false));
    await answer(s.cookie, intro(id, true));
    return { ...s, id, lemma: lemmaOf(2) };
  }

  it("checks the usage choice against the stored sentence", async () => {
    const { cookie, id, lemma } = await inGames();
    const g = fixtureGames(lemma, 2);
    const wrong = await answer(cookie, { wordId: id, stage: "games", game: "usage", kind: "choice", answer: g.usage!.wrong[0] });
    expect(wrong.result.verdict).toBe("incorrect");
    const right = await answer(cookie, { wordId: id, stage: "games", game: "usage", kind: "choice", answer: g.usage!.correct });
    expect(right.result).toMatchObject({ verdict: "correct", definition: rightAnswer(lemma) });
  });

  it("accepts a typed blank in any case, and the bank's word", async () => {
    const { cookie, id, lemma } = await inGames();
    expect((await answer(cookie, { wordId: id, stage: "games", game: "cloze", kind: "typed", answer: lemma.toUpperCase() })).result.verdict).toBe(
      "correct",
    );
    expect((await answer(cookie, { wordId: id, stage: "games", game: "cloze", kind: "typed", answer: `${lemma}x` })).result.verdict).toBe(
      "incorrect",
    );
    expect((await answer(cookie, { wordId: id, stage: "games", game: "cloze", kind: "choice", answer: lemma })).result.verdict).toBe("correct");
  });

  it("grades a sentence with the grader", async () => {
    const { cookie, id, lemma } = await inGames();
    const bad = await answer(cookie, { wordId: id, stage: "games", game: "sentence", kind: "typed", answer: "too short" });
    expect(bad.result.verdict).toBe("incorrect");
    const good = await answer(cookie, { wordId: id, stage: "games", game: "sentence", kind: "typed", answer: `I saw a ${lemma} at the market today.` });
    expect(good.result).toMatchObject({ verdict: "correct", feedback: "Stub grader: matches the reference." });
  });
});

describe("adaptive", () => {
  async function firstSights(cookie: string, rights: number) {
    let last: StudyAnswerResponse | null = null;
    let rank = 0;
    for (let i = 0; i < ADAPT_WINDOW; i++) {
      do rank++;
      while (rank % 10 === 0);
      last = await answer(cookie, intro(wordId("en", rank), i < rights));
    }
    return last!;
  }

  const cursor = async (userId: string) =>
    (await env.DB.prepare("SELECT cursor_rank, adapt_total FROM courses WHERE user_id = ? AND lang = 'en'").bind(userId).first<{ cursor_rank: number; adapt_total: number }>())!;

  it("moves new words a band rarer after a strong run", async () => {
    const { cookie, user } = await started();
    const last = await firstSights(cookie, ADAPT_WINDOW);
    expect(last.levelChange).toBe("up");
    expect(await cursor(user.id)).toEqual({ cursor_rank: ADAPT_STEP, adapt_total: 0 });
    // Park the words in progress, so the session has room for new ones.
    await env.DB.prepare("UPDATE user_words SET due_at = ? WHERE user_id = ?").bind(Date.now() + DAY, user.id).run();
    const s = await getSession(cookie);
    expect(s.words[0]).toMatchObject({ isNew: true, rank: ADAPT_STEP + 1 });
  });

  it("moves new words back after a weak run", async () => {
    const { cookie, user } = await started();
    await env.DB.prepare("UPDATE courses SET cursor_rank = ? WHERE user_id = ?").bind(ADAPT_STEP + 500, user.id).run();
    const last = await firstSights(cookie, 5);
    expect(last.levelChange).toBe("down");
    expect((await cursor(user.id)).cursor_rank).toBe(500);
  });

  it("does not move past the last word the level teaches", async () => {
    const { cookie, user } = await started();
    await env.DB.prepare("UPDATE courses SET cursor_rank = 5000 WHERE user_id = ?").bind(user.id).run();
    const last = await firstSights(cookie, ADAPT_WINDOW);
    expect(last.levelChange).toBeNull();
    expect(await cursor(user.id)).toEqual({ cursor_rank: 5000, adapt_total: 0 });
  });

  it("starts over from the starting point when the level changes", async () => {
    const { cookie, user } = await started();
    await env.DB.prepare("UPDATE courses SET cursor_rank = 3000, adapt_total = 7 WHERE user_id = ?").bind(user.id).run();
    await jsonRequest("/courses/en/level", "PUT", { level: "fluent" }, cookie);
    expect(await cursor(user.id)).toEqual({ cursor_rank: 3000, adapt_total: 7 });
    await jsonRequest("/courses/en/level", "PUT", { level: "beginner" }, cookie);
    expect(await cursor(user.id)).toEqual({ cursor_rank: 0, adapt_total: 0 });
  });

  it("leaves placement alone in between", async () => {
    const { cookie, user } = await started();
    const last = await firstSights(cookie, 14);
    expect(last.levelChange).toBeNull();
    expect(await cursor(user.id)).toEqual({ cursor_rank: 0, adapt_total: 0 });
  });
});

describe("words", () => {
  it("lists learning, known and recovered words", async () => {
    const { cookie, user } = await started();
    const [a, b, c] = [1, 2, 3].map((r) => wordId("en", r));
    // a: right first time and learned; b: missed, then learned; c: in games.
    for (const [id, miss] of [
      [a, false],
      [b, true],
    ] as const) {
      if (miss) await answer(cookie, intro(id, false));
      await answer(cookie, intro(id, true));
      for (let i = 0; i < (miss ? 3 : 1); i++) await answer(cookie, game(id, true));
      await ago(user.id, id);
      await answer(cookie, define(id, true));
    }
    await answer(cookie, intro(c, true));

    const list = async (tab: string) => {
      const res = await request(`/courses/en/words?status=${tab}`, { headers: cookieHeader(cookie) });
      return ((await res.json()) as { words: WordListItem[] }).words;
    };
    expect((await list("known")).map((w) => w.wordId)).toEqual([a, b]);
    expect(await list("learning")).toEqual([
      expect.objectContaining({ wordId: c, stage: "games", gamesDone: 0, gamesNeeded: 1, decayed: false, definition: rightAnswer(lemmaOf(3)) }),
    ]);
    expect(await list("recovered")).toEqual([expect.objectContaining({ wordId: b, stage: "known", failCount: 1 })]);

    const course = await request("/courses/en", { headers: cookieHeader(cookie) });
    expect(((await course.json()) as { course: unknown }).course).toMatchObject({ known: 2, learning: 1, recovered: 1, due: 0 });
  });

  it("shows French definitions in the chosen language", async () => {
    const { cookie } = await started("fr");
    await jsonRequest("/courses/fr/settings", "PUT", { defLang: "en", answerLang: "either" }, cookie);
    const s = await getSession(cookie, "fr");
    expect(s.words[0].definition).toBe(`${s.words[0].lemma}ness (en)`);
  });

  it("refuses a word from the other language", async () => {
    const { cookie } = await started();
    const res = await jsonRequest("/courses/en/answer", "POST", intro(wordId("fr", 1), false), cookie);
    expect(res.status).toBe(404);
  });
});
