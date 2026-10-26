import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { AnswerResult, Card, WordListItem } from "../../shared/api";
import { cookieHeader, jsonRequest, registerAndLogin, request, rightAnswer, seedWords, wordId } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const email = () => `study${++seq}@example.com`;

beforeAll(async () => {
  await seedWords("en", 200);
  await seedWords("fr", 200);
});

async function started(lang = "en") {
  const session = await registerAndLogin(email());
  await request(`/courses/${lang}/start-from-beginning`, { method: "POST", headers: cookieHeader(session.cookie) });
  return session;
}

async function cards(path: string, cookie: string): Promise<Card[]> {
  const res = await request(path, { headers: cookieHeader(cookie) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { cards: Card[] }).cards;
}

async function answer(cookie: string, body: Record<string, unknown>, lang = "en"): Promise<AnswerResult> {
  const res = await jsonRequest(`/courses/${lang}/answer`, "POST", body, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { result: AnswerResult }).result;
}

async function userWord(userId: string, id: number) {
  return env.DB.prepare("SELECT status, box, due_at, fail_count FROM user_words WHERE user_id = ? AND word_id = ?")
    .bind(userId, id)
    .first<{ status: string; box: number; due_at: number; fail_count: number }>();
}

describe("learn", () => {
  it("needs a starting point", async () => {
    const { cookie } = await registerAndLogin(email());
    expect((await request("/courses/en/learn", { headers: cookieHeader(cookie) })).status).toBe(409);
  });

  it("serves eligible new words in rank order as typed cards", async () => {
    const { cookie } = await started();
    const batch = await cards("/courses/en/learn", cookie);
    expect(batch.map((c) => c.wordId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11].map((r) => wordId("en", r)));
    expect(batch.every((c) => c.kind === "typed" && c.isNew && c.options === undefined)).toBe(true);
  });

  it("marks a right answer known in box 1 and moves past it", async () => {
    const { cookie, user } = await started();
    const [first] = await cards("/courses/en/learn", cookie);
    const before = Date.now();
    const result = await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "typed", answer: rightAnswer(first.lemma) });
    expect(result).toEqual({
      verdict: "correct",
      feedback: "Stub grader: matches the reference.",
      definition: rightAnswer(first.lemma),
      glosses: [rightAnswer(first.lemma)],
      example: `An example sentence with ${first.lemma}.`,
    });
    const row = await userWord(user.id, first.wordId);
    expect(row).toMatchObject({ status: "known", box: 1, fail_count: 0 });
    expect(row!.due_at).toBeGreaterThanOrEqual(before + DAY);
    const next = await cards("/courses/en/learn", cookie);
    expect(next[0].wordId).toBe(wordId("en", 2));
  });

  it("brings a failed word back first next session, and a retry does not reschedule it", async () => {
    const { cookie, user } = await started();
    const [first] = await cards("/courses/en/learn", cookie);
    await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "dontknow" });
    expect(await userWord(user.id, first.wordId)).toMatchObject({ status: "learning", box: 0, fail_count: 1 });

    // Shown again later in the same session and answered right: still learning.
    await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "typed", answer: rightAnswer(first.lemma), retry: true });
    expect(await userWord(user.id, first.wordId)).toMatchObject({ status: "learning", box: 0, fail_count: 1 });

    const next = await cards("/courses/en/learn", cookie);
    expect(next[0]).toMatchObject({ wordId: first.wordId, isNew: false });
    expect(next[1].wordId).toBe(wordId("en", 2));

    await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "typed", answer: rightAnswer(first.lemma) });
    expect(await userWord(user.id, first.wordId)).toMatchObject({ status: "known", box: 1, fail_count: 1 });
  });

  it("grades a wrong typed answer incorrect", async () => {
    const { cookie } = await started();
    const [first] = await cards("/courses/en/learn", cookie);
    const result = await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "typed", answer: "something else" });
    expect(result.verdict).toBe("incorrect");
  });

  it("shows French words with English definitions when the user picks them", async () => {
    const { cookie } = await started("fr");
    await jsonRequest("/courses/fr/settings", "PUT", { defLang: "en", answerLang: "either" }, cookie);
    const [first] = await cards("/courses/fr/learn", cookie);
    const result = await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "dontknow" }, "fr");
    expect(result.definition).toBe(rightAnswer(first.lemma, "en"));
  });

  it("refuses a word from the other language", async () => {
    const { cookie } = await started();
    const res = await jsonRequest("/courses/en/answer", "POST", { wordId: wordId("fr", 1), mode: "learn", kind: "dontknow" }, cookie);
    expect(res.status).toBe(404);
  });
});

describe("review", () => {
  it("serves known words once due and moves them up a box", async () => {
    const { cookie, user } = await started();
    const [first] = await cards("/courses/en/learn", cookie);
    await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "typed", answer: rightAnswer(first.lemma) });
    expect(await cards("/courses/en/review", cookie)).toEqual([]);

    await env.DB.prepare("UPDATE user_words SET due_at = ? WHERE user_id = ?").bind(Date.now() - 1, user.id).run();
    const due = await cards("/courses/en/review", cookie);
    expect(due.map((c) => c.wordId)).toEqual([first.wordId]);
    await answer(cookie, { wordId: first.wordId, mode: "review", kind: "typed", answer: rightAnswer(first.lemma) });
    const row = await userWord(user.id, first.wordId);
    expect(row).toMatchObject({ status: "known", box: 2 });
    expect(row!.due_at).toBeGreaterThan(Date.now() + 2.9 * DAY);
  });

  it("drops a missed review back to learning", async () => {
    const { cookie, user } = await started();
    const [first] = await cards("/courses/en/learn", cookie);
    await answer(cookie, { wordId: first.wordId, mode: "learn", kind: "typed", answer: rightAnswer(first.lemma) });
    await env.DB.prepare("UPDATE user_words SET due_at = ?, box = 4 WHERE user_id = ?").bind(Date.now() - 1, user.id).run();
    await answer(cookie, { wordId: first.wordId, mode: "review", kind: "dontknow" });
    expect(await userWord(user.id, first.wordId)).toMatchObject({ status: "learning", box: 0 });
  });
});

describe("words", () => {
  it("lists known and learning words", async () => {
    const { cookie } = await started();
    const [a, b] = await cards("/courses/en/learn", cookie);
    await answer(cookie, { wordId: a.wordId, mode: "learn", kind: "typed", answer: rightAnswer(a.lemma) });
    await answer(cookie, { wordId: b.wordId, mode: "learn", kind: "dontknow" });
    const known = await request("/courses/en/words?status=known", { headers: cookieHeader(cookie) });
    const { words } = (await known.json()) as { words: WordListItem[] };
    expect(words).toEqual([{ wordId: a.wordId, lemma: a.lemma, rank: 1, status: "known", box: 1, dueAt: expect.any(Number), definition: rightAnswer(a.lemma) }]);
    const learning = await request("/courses/en/words?status=learning", { headers: cookieHeader(cookie) });
    expect(((await learning.json()) as { words: WordListItem[] }).words.map((w) => w.wordId)).toEqual([b.wordId]);
  });
});
