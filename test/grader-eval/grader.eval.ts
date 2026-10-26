// Agreement of the real grader with hand-labelled answers. Calls the Claude API (about 100
// requests, well under a cent on Haiku), so it only runs on demand: `npm run eval:grader`.

import { readFileSync } from "node:fs";
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

const MIN_AGREEMENT = 0.85;

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
  const graded = await mapLimit(cases, 5, async (c) => ({ c, g: await grade(env, { ...c, wordLang: c.lang }) }));

  const misses = graded.filter(({ c, g }) => g.verdict !== c.expected);
  const agreement = 1 - misses.length / cases.length;
  // Correct vs not correct is what drives scheduling, so report it separately.
  const binary = graded.filter(({ c, g }) => (g.verdict === "correct") === (c.expected === "correct")).length / cases.length;
  const tokens = graded.reduce((s, { g }) => s + g.inputTokens + g.outputTokens, 0);
  console.log(
    [
      `${lang}: ${(agreement * 100).toFixed(0)}% exact, ${(binary * 100).toFixed(0)}% correct/not-correct, ${tokens} tokens`,
      ...misses.map(({ c, g }) => `  ${c.lemma} | ${c.answer} | expected ${c.expected}, got ${g.verdict} (${c.note}) | ${g.feedback}`),
    ].join("\n"),
  );
  expect(agreement).toBeGreaterThanOrEqual(MIN_AGREEMENT);
}, 300_000);
