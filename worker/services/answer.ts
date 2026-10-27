import type { Answer, AnswerResult, GameKind, Mode, Stage, Verdict } from "../../shared/api";
import { clozeMatches } from "../../shared/session";
import { definitionIn, gamesOf, glossesIn, type CourseRow, type WordRow } from "../db";
import { now } from "../http";
import { HttpError } from "../router";
import { gradingState, recordUsage } from "./budget";
import { grade, type Grade } from "./grader";

/** An answer, with the study stage and game it was given in (absent in the assessment). */
export type Judged = Answer & { stage?: Stage; game?: GameKind; correct?: boolean };

/** Judges one answer, logs it in attempts, and returns what the learner sees next. */
export async function evaluate(
  env: Env,
  course: CourseRow,
  word: WordRow,
  body: Judged,
  mode: Mode,
): Promise<AnswerResult> {
  const definition = definitionIn(word, course.def_lang);
  const glosses = glossesIn(word, course.def_lang);
  let verdict: Verdict = "incorrect";
  let feedback: string | null = null;
  let g: Grade | null = null;
  const answer = body.answer?.trim() ?? "";

  const games = gamesOf(word);
  const right = (ok: boolean): Verdict => (ok ? "correct" : "incorrect");

  if (body.kind === "match") {
    // Boards are judged on the client, which saw every tap.
    verdict = right(body.correct === true);
  } else if (body.kind === "choice") {
    if (body.game === "usage") verdict = right(answer === games.usage?.correct);
    else if (body.game === "cloze") verdict = right(answer === games.cloze?.answer);
    else verdict = right(answer === definition);
  } else if (body.kind === "typed" && body.game === "cloze") {
    verdict = right(games.cloze !== null && clozeMatches(answer, games.cloze.answer, word.lemma));
  } else if (body.kind === "typed") {
    if (!answer) throw new HttpError(400, "Answer is empty");
    const { status, escalate } = await gradingState(env, course.user_id);
    if (status.choiceOnly) throw new HttpError(409, "Typed answers are paused", { reason: status.reason });
    g = await grade(
      env,
      {
        task: body.game === "sentence" ? "sentence" : "define",
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
    `INSERT INTO attempts (user_id, word_id, mode, kind, answer, verdict, graded, input_tokens, output_tokens, escalated, cost_micro_usd, stage, game, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      body.stage ?? null,
      body.game ?? null,
      now(),
    )
    .run();

  return { verdict, feedback, definition, glosses, example: word.example };
}
