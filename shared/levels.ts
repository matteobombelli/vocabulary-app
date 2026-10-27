// What a learner's self-reported level changes: which words they are taught, where the
// assessment starts, and which games their words get.

import { bandCount } from "./assessment";

export const LEVELS = ["beginner", "intermediate", "fluent", "native"] as const;
export type Level = (typeof LEVELS)[number];

// Word tiers (migrations/0003_lifecycle.sql): 3 core, 2 general, 1 rare, 0 never taught.
export const LEVEL_TIERS: Record<Level, number[]> = {
  beginner: [3],
  intermediate: [2, 3],
  fluent: [1, 2, 3],
  native: [1, 2, 3],
};

// Without a level the learner gets the widest list, as before levels existed.
export function tiersFor(level: Level | null): number[] {
  return LEVEL_TIERS[level ?? "fluent"];
}

// Share of the bands the assessment staircase starts at.
const START_SHARE: Record<Level, number> = { beginner: 0, intermediate: 0.15, fluent: 0.35, native: 0.55 };

export function startBand(level: Level | null, maxRank: number): number {
  const bands = bandCount(maxRank);
  if (level === null) return Math.floor(bands / 2);
  return Math.min(bands - 1, Math.floor(bands * START_SHARE[level]));
}

export const GAMES = ["usage", "cloze", "synonym", "antonym", "sentence"] as const;
export type Game = (typeof GAMES)[number];

// How often each game is drawn for a word, by level. Beginners get recognition games, fluent and
// native speakers get production (writing a sentence, typing the blank) and antonyms.
export const GAME_WEIGHTS: Record<Level, Record<Game, number>> = {
  beginner: { usage: 3, cloze: 3, synonym: 2, antonym: 1, sentence: 0 },
  intermediate: { usage: 2, cloze: 2, synonym: 2, antonym: 1, sentence: 1 },
  fluent: { usage: 1, cloze: 2, synonym: 1, antonym: 2, sentence: 3 },
  native: { usage: 1, cloze: 2, synonym: 1, antonym: 2, sentence: 3 },
};

/** Beginners pick the missing word from a bank; everyone else types it. */
export function clozeTyped(level: Level | null): boolean {
  return level !== "beginner";
}

// Adaptive placement: every ADAPT_WINDOW first-sight answers on new words, a share right at or
// above ADAPT_UP moves new words a band rarer, at or below ADAPT_DOWN a band commoner.
export const ADAPT_WINDOW = 20;
export const ADAPT_UP = 0.85;
export const ADAPT_DOWN = 0.5;
export const ADAPT_STEP = 2500;

export type LevelChange = "up" | "down" | null;

export function adaptiveMove(right: number, total: number): LevelChange {
  if (total < ADAPT_WINDOW) return null;
  if (right / total >= ADAPT_UP) return "up";
  if (right / total <= ADAPT_DOWN) return "down";
  return null;
}
