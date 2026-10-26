import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { AssessmentAnswerResponse, AssessmentStep, Card } from "../../shared/api";
import { ASSESSMENT_ITEMS } from "../../shared/assessment";
import { cookieHeader, jsonRequest, registerAndLogin, request, rightAnswer, seedWords } from "./helpers";

const WORDS = 12_500;
const KNOWS_UP_TO = 5_000;

let seq = 0;
const email = () => `assess${++seq}@example.com`;

beforeAll(async () => {
  await seedWords("en", WORDS);
});

function rankOf(card: Card): number {
  return card.wordId - 1_000_000;
}

/** Answers like someone who knows every word up to KNOWS_UP_TO. */
function answerFor(card: Card) {
  if (rankOf(card) > KNOWS_UP_TO) return { wordId: card.wordId, kind: "dontknow" as const };
  return { wordId: card.wordId, kind: card.kind, answer: rightAnswer(card.lemma) };
}

describe("assessment", () => {
  it("runs to the end and sets the course's start", async () => {
    const { cookie, user } = await registerAndLogin(email());
    const start = await request("/courses/en/assessment", { method: "POST", headers: cookieHeader(cookie) });
    expect(start.status).toBe(201);
    let step: AssessmentStep | null = ((await start.json()) as { step: AssessmentStep }).step;
    let outcome: AssessmentAnswerResponse["outcome"] = null;
    const kinds = new Set<string>();
    let answered = 0;
    while (step) {
      kinds.add(step.card.kind);
      if (step.card.kind === "choice") {
        expect(step.card.options).toHaveLength(4);
        expect(step.card.options).toContain(rightAnswer(step.card.lemma));
      }
      const res = await jsonRequest(`/courses/en/assessment/${step.assessmentId}/answer`, "POST", answerFor(step.card), cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as AssessmentAnswerResponse;
      expect(body.result.verdict).toBe(rankOf(step.card) <= KNOWS_UP_TO ? "correct" : "incorrect");
      step = body.next;
      outcome = body.outcome;
      answered++;
    }
    expect(answered).toBe(ASSESSMENT_ITEMS);
    expect(kinds).toEqual(new Set(["choice", "typed"]));
    expect(outcome!.estSize).toBeGreaterThan(KNOWS_UP_TO * 0.8);
    expect(outcome!.estSize).toBeLessThan(KNOWS_UP_TO * 1.25);
    expect(outcome!.startRank).toBeLessThanOrEqual(KNOWS_UP_TO * 1.1);
    expect(outcome!.totalWords).toBe(WORDS);

    const course = await request("/courses/en", { headers: cookieHeader(cookie) });
    const { course: c } = (await course.json()) as { course: { startRank: number; estSize: number; known: number } };
    expect(c.startRank).toBe(outcome!.startRank);
    expect(c.estSize).toBe(outcome!.estSize);
    // Words answered right during the assessment are known and never reviewed.
    const known = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(due_at) AS due FROM user_words WHERE user_id = ?")
      .bind(user.id)
      .first<{ n: number; due: number | null }>();
    expect(known!.n).toBe(c.known);
    expect(known!.n).toBeGreaterThan(0);
    expect(known!.due).toBeNull();
  });

  it("only accepts the current question", async () => {
    const { cookie } = await registerAndLogin(email());
    const start = await request("/courses/en/assessment", { method: "POST", headers: cookieHeader(cookie) });
    const { step } = (await start.json()) as { step: AssessmentStep };
    const wrong = await jsonRequest(
      `/courses/en/assessment/${step.assessmentId}/answer`,
      "POST",
      { wordId: step.card.wordId + 1, kind: "dontknow" },
      cookie,
    );
    expect(wrong.status).toBe(409);
    const ok = await jsonRequest(`/courses/en/assessment/${step.assessmentId}/answer`, "POST", { wordId: step.card.wordId, kind: "dontknow" }, cookie);
    expect(ok.status).toBe(200);
    // The same answer again is no longer the current question.
    const again = await jsonRequest(`/courses/en/assessment/${step.assessmentId}/answer`, "POST", { wordId: step.card.wordId, kind: "dontknow" }, cookie);
    expect(again.status).toBe(409);
  });

  it("is private to its user", async () => {
    const a = await registerAndLogin(email());
    const b = await registerAndLogin(email());
    const start = await request("/courses/en/assessment", { method: "POST", headers: cookieHeader(a.cookie) });
    const { step } = (await start.json()) as { step: AssessmentStep };
    const res = await jsonRequest(`/courses/en/assessment/${step.assessmentId}/answer`, "POST", { wordId: step.card.wordId, kind: "dontknow" }, b.cookie);
    expect(res.status).toBe(404);
  });

  it("refuses a language with no words", async () => {
    const { cookie } = await registerAndLogin(email());
    const res = await request("/courses/fr/assessment", { method: "POST", headers: cookieHeader(cookie) });
    expect(res.status).toBe(409);
  });
});
