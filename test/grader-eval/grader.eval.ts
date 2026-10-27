// Agreement of the real grader with hand-labelled answers, and what it costs. Calls the Claude
// API, so it only runs on demand: `npm run eval:grader` (EVAL_ESCALATE=0 to grade with Haiku alone).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { AnswerLang, Lang, Verdict } from "../../shared/api";
import { grade } from "../../worker/services/grader";

interface Case {
  lemma: string;
  pos: string;
  lang: Lang;
  defLang: Lang;
  answerLang: AnswerLang;
  glosses: string[];
  definition: string;
  answer: string;
  expected: Verdict;
  note: string;
}

// Correct vs not correct is what drives scheduling, so it is the number that has to hold up.
const MIN_BINARY_AGREEMENT = 0.9;

function load(lang: Lang): Case[] {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), `${lang}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Case);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// The key from the environment, else from .dev.vars (gitignored), where local development keeps it.
function apiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const vars = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../.dev.vars"), "utf8");
    return /^ANTHROPIC_API_KEY=(.+)$/m.exec(vars)?.[1].trim() ?? "";
  } catch {
    return "";
  }
}

it.each(["en", "fr"] as const)("grader agrees with the %s labels", async (lang) => {
  const env = { GRADER_MODE: "claude", ANTHROPIC_API_KEY: apiKey() } as Env;
  const cases = load(lang);
  const escalate = process.env.EVAL_ESCALATE !== "0";
  const graded = await mapLimit(cases, 5, async (c) => ({ c, g: await grade(env, { ...c, wordLang: c.lang }, escalate) }));

  const isRight = (c: Case, v: Verdict) => (v === "correct") === (c.expected === "correct");
  const misses = graded.filter(({ c, g }) => g.verdict !== c.expected);
  const exact = 1 - misses.length / cases.length;
  const binary = graded.filter(({ c, g }) => isRight(c, g.verdict)).length / cases.length;
  const escalated = graded.filter(({ g }) => g.escalated).length;
  const costPerAnswer = graded.reduce((s, { g }) => s + g.costMicroUsd, 0) / cases.length / 1e6;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const plain = graded.filter(({ g }) => !g.escalated);
  const firstCost = plain.reduce((s, { g }) => s + g.costMicroUsd, 0) / Math.max(plain.length, 1) / 1e6;
  const firstTokens = plain.reduce((s, { g }) => s + g.outputTokens, 0) / Math.max(plain.length, 1);
  const report = [
      `${lang}: ${pct(binary)} correct/not-correct, ${pct(exact)} exact, ${escalated}/${cases.length} escalated, ` +
        `$${costPerAnswer.toFixed(6)} per answer ($${(costPerAnswer * 10_000).toFixed(2)} per 10k); ` +
        `Haiku alone $${firstCost.toFixed(6)}, ${firstTokens.toFixed(0)} output tokens`,
      ...misses.map(
        ({ c, g }) =>
          `  ${isRight(c, g.verdict) ? " " : "✗"} ${c.lemma} | ${c.answer} | expected ${c.expected}, got ${g.verdict}${g.escalated ? " (Sonnet)" : ""} (${c.note}) | ${g.feedback}`,
      ),
    ].join("\n");
  console.log(report);
  // Also kept on disk, since Vitest hides the output of passing tests.
  const out = join(dirname(fileURLToPath(import.meta.url)), "../../test-results");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `grader-eval-${lang}${escalate ? "" : "-haiku-only"}.txt`), report + "\n");
  expect(binary).toBeGreaterThanOrEqual(MIN_BINARY_AGREEMENT);
}, 300_000);
