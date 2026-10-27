import type { Status } from "../../shared/api";
import { now } from "../http";

// Shares of MONTHLY_BUDGET_USD: past the first, "partial" verdicts are no longer re-graded by
// Sonnet; past the second, typed answers stop altogether.
const ESCALATION_STOP_SHARE = 0.7;
const BUDGET_STOP_SHARE = 0.9;
const DAY_MS = 24 * 60 * 60 * 1000;

export function monthKey(t: number): string {
  return new Date(t).toISOString().slice(0, 7);
}

/** Whether typed answers can be graded for this user right now. */
export async function gradingStatus(env: Env, userId: string): Promise<Status> {
  return (await gradingState(env, userId)).status;
}

/** The status, plus whether a "partial" verdict may still be escalated to Sonnet this month. */
export async function gradingState(env: Env, userId: string): Promise<{ status: Status; escalate: boolean }> {
  const t = now();
  const dayStart = t - (t % DAY_MS);
  const dailyCap = Number(env.DAILY_GRADED_CAP);
  const [usage, today] = await Promise.all([
    env.DB.prepare("SELECT cost_micro_usd FROM api_usage WHERE month = ?").bind(monthKey(t)).first<{ cost_micro_usd: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE user_id = ? AND created_at >= ? AND graded = 1")
      .bind(userId, dayStart)
      .first<{ n: number }>(),
  ]);
  const gradedToday = today?.n ?? 0;
  const budget = Number(env.MONTHLY_BUDGET_USD) * 1e6;
  const spent = usage?.cost_micro_usd ?? 0;
  let reason: Status["reason"] = null;
  if (env.GRADER_MODE !== "stub" && !env.ANTHROPIC_API_KEY) reason = "unavailable";
  else if (spent >= budget * BUDGET_STOP_SHARE) reason = "budget";
  else if (gradedToday >= dailyCap) reason = "daily_cap";
  return {
    status: { choiceOnly: reason !== null, reason, gradedToday, dailyCap },
    escalate: spent < budget * ESCALATION_STOP_SHARE,
  };
}

export async function recordUsage(db: D1Database, inputTokens: number, outputTokens: number, costMicroUsd: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO api_usage (month, calls, input_tokens, output_tokens, cost_micro_usd) VALUES (?, 1, ?, ?, ?)
       ON CONFLICT (month) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd`,
    )
    .bind(monthKey(now()), inputTokens, outputTokens, costMicroUsd)
    .run();
}
