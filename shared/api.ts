import { z } from "zod";

export const APP_BASE = "/projects/vocabulary-app";
export const API_PREFIX = `${APP_BASE}/api`;

export const LANGS = ["en", "fr"] as const;
export const Lang = z.enum(LANGS);
export type Lang = z.infer<typeof Lang>;

export const AnswerLang = z.enum(["en", "fr", "either"]);
export type AnswerLang = z.infer<typeof AnswerLang>;

// Which definition languages each course offers; the first is the default.
export const DEF_LANGS: Record<Lang, Lang[]> = { en: ["en"], fr: ["fr", "en"] };

const Email = z.string().trim().toLowerCase().pipe(z.email());
const Password = z.string().min(8).max(200);

// Body types are the wire (input) shape, i.e. what a client sends.
export const RegisterBody = z.object({ email: Email, password: Password, inviteCode: z.string().min(1) });
export type RegisterBody = z.input<typeof RegisterBody>;

export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(200) });
export type LoginBody = z.input<typeof LoginBody>;

export const CourseSettings = z.object({ defLang: Lang, answerLang: AnswerLang });
export type CourseSettings = z.input<typeof CourseSettings>;

export const Mode = z.enum(["assessment", "learn", "review"]);
export type Mode = z.infer<typeof Mode>;

export const AnswerKind = z.enum(["typed", "choice", "dontknow"]);
export type AnswerKind = z.infer<typeof AnswerKind>;

export const Answer = z.object({
  wordId: z.number().int(),
  kind: AnswerKind,
  // The typed definition, or the chosen option's text. Absent for "dontknow".
  answer: z.string().trim().max(500).optional(),
});
export type Answer = z.input<typeof Answer>;

export const StudyAnswer = Answer.extend({
  mode: z.enum(["learn", "review"]),
  // A failed card shown again later in the same session: logged, but scheduling is unchanged.
  retry: z.boolean().default(false),
});
export type StudyAnswer = z.input<typeof StudyAnswer>;

export type Verdict = "correct" | "partial" | "incorrect";

export interface User {
  id: string;
  email: string;
}

export interface Course {
  lang: Lang;
  defLang: Lang;
  answerLang: AnswerLang;
  startRank: number | null;
  estSize: number | null;
  assessedAt: number | null;
  totalWords: number;
  known: number;
  learning: number;
  due: number;
}

export interface Card {
  wordId: number;
  lemma: string;
  pos: string;
  kind: "typed" | "choice";
  // Multiple-choice options in the course's definition language, shuffled. Only for "choice".
  options?: string[];
  isNew: boolean;
}

export interface AnswerResult {
  verdict: Verdict;
  // The grader's one line, for typed answers.
  feedback: string | null;
  definition: string;
  glosses: string[];
  example: string;
}

export interface Status {
  // True when typed answers cannot be graded right now; every card is then multiple choice.
  choiceOnly: boolean;
  reason: "budget" | "daily_cap" | "unavailable" | null;
  gradedToday: number;
  dailyCap: number;
}

export interface AssessmentStep {
  assessmentId: string;
  index: number;
  total: number;
  card: Card;
}

export interface AssessmentOutcome {
  estSize: number;
  startRank: number;
  totalWords: number;
}

export interface AssessmentAnswerResponse {
  result: AnswerResult;
  next: AssessmentStep | null;
  outcome: AssessmentOutcome | null;
}

export interface WordListItem {
  wordId: number;
  lemma: string;
  rank: number;
  status: "known" | "learning";
  box: number | null;
  dueAt: number | null;
  definition: string;
}
