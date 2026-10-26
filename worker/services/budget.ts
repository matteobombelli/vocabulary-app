import type { Status } from "../../shared/api";
import { now } from "../http";
import { costMicroUsd } from "./grader";

// Graded answers stop once the month's spend reaches this share of MONTHLY_BUDGET_USD.
const BUDGET_STOP_SHARE = 0.9;
const DAY_MS = 24 * 60 * 60 * 1000;

export function monthKey(t: number): string {
  return new Date(t).toISOString().slice(0, 7);
}

/** Whether typed answers can be graded for this user right now. */
export async function gradingStatus(env: Env, userId: string): Promise<Status> {
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
  let reason: Status["reason"] = null;
  if (env.GRADER_MODE !== "stub" && !env.ANTHROPIC_API_KEY) reason = "unavailable";
  else if ((usage?.cost_micro_usd ?? 0) >= budget * BUDGET_STOP_SHARE) reason = "budget";
  else if (gradedToday >= dailyCap) reason = "daily_cap";
  return { choiceOnly: reason !== null, reason, gradedToday, dailyCap };
}

export async function recordUsage(db: D1Database, inputTokens: number, outputTokens: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO api_usage (month, calls, input_tokens, output_tokens, cost_micro_usd) VALUES (?, 1, ?, ?, ?)
       ON CONFLICT (month) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd`,
    )
    .bind(monthKey(now()), inputTokens, outputTokens, costMicroUsd(inputTokens, outputTokens))
    .run();
}
