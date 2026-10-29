import { z } from "zod";
import { LEVELS, type Game, type Level, type LevelChange } from "./levels";
import { STAGES, type Stage } from "./lifecycle";

export const API_PREFIX = "/api";

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

export const LevelBody = z.object({ level: z.enum(LEVELS) });
export type LevelBody = z.input<typeof LevelBody>;

export const Mode = z.enum(["assessment", "learn"]);
export type Mode = z.infer<typeof Mode>;

// "match": a synonym or antonym board, judged on the client (correct says how it went).
export const AnswerKind = z.enum(["typed", "choice", "dontknow", "match"]);
export type AnswerKind = z.infer<typeof AnswerKind>;

export const Answer = z.object({
  wordId: z.number().int(),
  kind: AnswerKind,
  // The typed definition, or the chosen option's text. Absent for "dontknow".
  answer: z.string().trim().max(500).optional(),
});
export type Answer = z.input<typeof Answer>;

// What a study answer was: the definition multiple choice of a word's intro, a game, or the typed
// (or, when grading is paused, multiple-choice) definition of the define stage.
export const GameKind = z.enum(["mc", "usage", "cloze", "synonym", "antonym", "sentence", "define"]);
export type GameKind = z.infer<typeof GameKind>;

export const StudyAnswer = Answer.extend({
  // The stage the word was served in; an answer for a stale stage is logged but moves nothing.
  stage: z.enum(STAGES),
  game: GameKind,
  // For "match" answers only.
  correct: z.boolean().optional(),
  // Games stage: the games won before this answer, as the client saw them. An answer whose count
  // the server has moved past (a retry, a replay) is stale.
  gamesDone: z.number().int().min(0).optional(),
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
  level: Level | null;
  startRank: number | null;
  estSize: number | null;
  assessedAt: number | null;
  totalWords: number;
  // Words in each stage: known (including decayed ones), learning (intro, games or define),
  // recovered (known after a miss), due (known words decayed back to define).
  known: number;
  learning: number;
  recovered: number;
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
  // The stage the word would be served in now (a decayed known word is "define").
  stage: Stage;
  decayed: boolean;
  gamesDone: number;
  gamesNeeded: number;
  dueAt: number | null;
  failCount: number;
  definition: string;
}

export type WordListTab = "learning" | "known" | "recovered";

// Game content for a word, in its own language (migrations/0003_lifecycle.sql).
export interface GameContent {
  synonyms: string[];
  antonyms: string[];
  cloze: { sentence: string; answer: string; bank: string[] } | null;
  usage: { correct: string; wrong: string[] } | null;
}

export interface SessionWord {
  wordId: number;
  lemma: string;
  pos: string;
  rank: number;
  // The stage it is served in.
  stage: Stage;
  // Never answered before.
  isNew: boolean;
  // A known word whose meaning decayed: served as define.
  decayed: boolean;
  gamesNeeded: number;
  gamesDone: number;
  failCount: number;
  // Definition multiple-choice options, shuffled, in the course's definition language.
  options: string[];
  definition: string;
  glosses: string[];
  example: string;
  games: GameContent;
}

// A word the learner knows, used to fill synonym and antonym boards.
export interface PairWord {
  wordId: number;
  lemma: string;
  synonyms: string[];
  antonyms: string[];
}

export interface StudySession {
  level: Level | null;
  words: SessionWord[];
  known: PairWord[];
  status: Status;
}

export interface StudyAnswerResponse {
  result: AnswerResult;
  levelChange: LevelChange;
}

export type { Game, Level, LevelChange, Stage };
