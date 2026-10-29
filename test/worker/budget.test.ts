import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { Status, StudySession } from "../../shared/api";
import { gradingState, monthKey } from "../../worker/services/budget";
import { cookieHeader, jsonRequest, registerAndLogin, request, rightAnswer, seedWords } from "./helpers";

let seq = 0;
const email = () => `budget${++seq}@example.com`;

beforeAll(async () => {
  await seedWords("en", 100);
});

async function status(cookie: string): Promise<Status> {
  const res = await request("/status", { headers: cookieHeader(cookie) });
  return ((await res.json()) as { status: Status }).status;
}

async function setMonthlyCost(microUsd: number) {
  await env.DB.prepare(
    "INSERT INTO api_usage (month, cost_micro_usd) VALUES (?, ?) ON CONFLICT (month) DO UPDATE SET cost_micro_usd = excluded.cost_micro_usd",
  )
    .bind(monthKey(Date.now()), microUsd)
    .run();
}

describe("budget guard", () => {
  it("allows grading under the budget", async () => {
    await setMonthlyCost(0);
    const { cookie } = await registerAndLogin(email());
    expect(await status(cookie)).toEqual({ choiceOnly: false, reason: null, gradedToday: 0, dailyCap: 200 });
  });

  it("stops escalating to Sonnet at 70% of the budget, before typed answers stop", async () => {
    const { user } = await registerAndLogin(email());
    // MONTHLY_BUDGET_USD is 5: 70% is 3.5 USD, 90% is 4.5 USD.
    await setMonthlyCost(3.4e6);
    expect(await gradingState(env, user.id)).toMatchObject({ escalate: true, status: { choiceOnly: false } });
    await setMonthlyCost(3.6e6);
    expect(await gradingState(env, user.id)).toMatchObject({ escalate: false, status: { choiceOnly: false } });
    await setMonthlyCost(0);
  });

  it("switches to multiple choice near the monthly budget", async () => {
    // MONTHLY_BUDGET_USD is 5; 90% of it is 4.5 USD.
    await setMonthlyCost(4.6e6);
    const { cookie } = await registerAndLogin(email());
    await request("/courses/en/start-from-beginning", { method: "POST", headers: cookieHeader(cookie) });
    expect(await status(cookie)).toMatchObject({ choiceOnly: true, reason: "budget" });

    const res = await request("/courses/en/session", { headers: cookieHeader(cookie) });
    const { session } = (await res.json()) as { session: StudySession };
    expect(session.status.choiceOnly).toBe(true);
    const cards = session.words;

    const choice = await jsonRequest(
      "/courses/en/answer",
      "POST",
      { wordId: cards[0].wordId, stage: "intro", game: "mc", kind: "choice", answer: rightAnswer(cards[0].lemma) },
      cookie,
    );
    expect(choice.status).toBe(200);
    expect(((await choice.json()) as { result: { verdict: string } }).result.verdict).toBe("correct");

    const typed = await jsonRequest(
      "/courses/en/answer",
      "POST",
      { wordId: cards[0].wordId, stage: "games", game: "sentence", kind: "typed", answer: "x", gamesDone: 0 },
      cookie,
    );
    expect(typed.status).toBe(409);
    expect(await typed.json()).toEqual({ error: "Typed answers are paused", details: { reason: "budget" } });
    await setMonthlyCost(0);
  });

  it("stops grading a user after the daily cap", async () => {
    await setMonthlyCost(0);
    const { cookie, user } = await registerAndLogin(email());
    const t = Date.now();
    const rows = Array.from({ length: 200 }, () =>
      env.DB.prepare("INSERT INTO attempts (user_id, word_id, mode, kind, verdict, graded, created_at) VALUES (?, 1, 'learn', 'typed', 'correct', 1, ?)").bind(user.id, t),
    );
    await env.DB.batch(rows);
    expect(await status(cookie)).toMatchObject({ choiceOnly: true, reason: "daily_cap", gradedToday: 200 });
  });

  it("records token usage for graded answers", async () => {
    await setMonthlyCost(0);
    const { cookie } = await registerAndLogin(email());
    await request("/courses/en/start-from-beginning", { method: "POST", headers: cookieHeader(cookie) });
    const before = await env.DB.prepare("SELECT calls FROM api_usage WHERE month = ?").bind(monthKey(Date.now())).first<{ calls: number }>();
    const res = await request("/courses/en/session", { headers: cookieHeader(cookie) });
    const { session } = (await res.json()) as { session: StudySession };
    const w = session.words[0];
    await jsonRequest("/courses/en/answer", "POST", { wordId: w.wordId, stage: "intro", game: "mc", kind: "choice", answer: rightAnswer(w.lemma) }, cookie);
    const graded = await jsonRequest(
      "/courses/en/answer",
      "POST",
      { wordId: w.wordId, stage: "games", game: "sentence", kind: "typed", answer: `I saw the ${w.lemma} near the gate today.` },
      cookie,
    );
    expect(graded.status).toBe(200);
    const after = await env.DB.prepare("SELECT calls FROM api_usage WHERE month = ?").bind(monthKey(Date.now())).first<{ calls: number }>();
    expect(after!.calls).toBe((before?.calls ?? 0) + 1);
  });
});
