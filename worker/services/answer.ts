import type { Answer, AnswerResult, Mode, Verdict } from "../../shared/api";
import { definitionIn, glossesIn, type CourseRow, type WordRow } from "../db";
import { now } from "../http";
import { HttpError } from "../router";
import { gradingStatus, recordUsage } from "./budget";
import { grade } from "./grader";

/** Judges one answer, logs it in attempts, and returns what the learner sees next. */
export async function evaluate(
  env: Env,
  course: CourseRow,
  word: WordRow,
  body: Answer,
  mode: Mode,
): Promise<AnswerResult> {
  const definition = definitionIn(word, course.def_lang);
  const glosses = glossesIn(word, course.def_lang);
  let verdict: Verdict = "incorrect";
  let feedback: string | null = null;
  let tokens = { input: 0, output: 0 };
  const answer = body.answer?.trim() ?? "";

  if (body.kind === "choice") {
    verdict = answer === definition ? "correct" : "incorrect";
  } else if (body.kind === "typed") {
    if (!answer) throw new HttpError(400, "Answer is empty");
    const status = await gradingStatus(env, course.user_id);
    if (status.choiceOnly) throw new HttpError(409, "Typed answers are paused", { reason: status.reason });
    const g = await grade(env, {
      lemma: word.lemma,
      pos: word.pos,
      wordLang: word.lang,
      glosses,
      definition,
      defLang: course.def_lang,
      answerLang: course.answer_lang,
      answer,
    });
    verdict = g.verdict;
    feedback = g.feedback;
    tokens = { input: g.inputTokens, output: g.outputTokens };
    await recordUsage(env.DB, g.inputTokens, g.outputTokens);
  }

  await env.DB.prepare(
    "INSERT INTO attempts (user_id, word_id, mode, kind, answer, verdict, graded, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(course.user_id, word.id, mode, body.kind, answer || null, verdict, body.kind === "typed" ? 1 : 0, tokens.input, tokens.output, now())
    .run();

  return { verdict, feedback, definition, glosses, example: word.example };
}
