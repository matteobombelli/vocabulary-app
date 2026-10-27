import type { Answer, AnswerResult, Mode, Verdict } from "../../shared/api";
import { definitionIn, glossesIn, type CourseRow, type WordRow } from "../db";
import { now } from "../http";
import { HttpError } from "../router";
import { gradingState, recordUsage } from "./budget";
import { grade, type Grade } from "./grader";

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
  let g: Grade | null = null;
  const answer = body.answer?.trim() ?? "";

  if (body.kind === "choice") {
    verdict = answer === definition ? "correct" : "incorrect";
  } else if (body.kind === "typed") {
    if (!answer) throw new HttpError(400, "Answer is empty");
    const { status, escalate } = await gradingState(env, course.user_id);
    if (status.choiceOnly) throw new HttpError(409, "Typed answers are paused", { reason: status.reason });
    g = await grade(
      env,
      {
        lemma: word.lemma,
        pos: word.pos,
        wordLang: word.lang,
        glosses,
        definition,
        defLang: course.def_lang,
        answerLang: course.answer_lang,
        answer,
      },
      escalate,
    );
    verdict = g.verdict;
    feedback = g.feedback;
    await recordUsage(env.DB, g.inputTokens, g.outputTokens, g.costMicroUsd);
  }

  await env.DB.prepare(
    `INSERT INTO attempts (user_id, word_id, mode, kind, answer, verdict, graded, input_tokens, output_tokens, escalated, cost_micro_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      course.user_id,
      word.id,
      mode,
      body.kind,
      answer || null,
      verdict,
      g ? 1 : 0,
      g?.inputTokens ?? 0,
      g?.outputTokens ?? 0,
      g?.escalated ? 1 : 0,
      g?.costMicroUsd ?? 0,
      now(),
    )
    .run();

  return { verdict, feedback, definition, glosses, example: word.example };
}
