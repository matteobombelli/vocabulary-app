// A word's lifecycle: multiple choice until right (intro), then games, then a typed definition in
// a later session (define), then known. A known word decays back to define after 7, 14, 30 and
// 90 days, and never after its fifth definition.

export const STAGES = ["intro", "games", "define", "known"] as const;
export type Stage = (typeof STAGES)[number];

export const DECAY_DAYS = [7, 14, 30, 90];
// Games to win before define: one after a right first sight, three otherwise.
export const GAMES_FAST = 1;
export const GAMES_FULL = 3;
// Define waits this long after the last game, so the meaning is recalled, not just remembered.
export const DEFINE_DELAY_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WordState {
  stage: Stage;
  gamesNeeded: number;
  gamesDone: number;
  // Times defined right; null for a word known at assessment.
  completions: number | null;
  dueAt: number | null;
  failCount: number;
  failedAt: number | null;
}

export function newWordState(now: number): WordState {
  return { stage: "intro", gamesNeeded: GAMES_FULL, gamesDone: 0, completions: 0, dueAt: now, failCount: 0, failedAt: null };
}

/** The stage a word is served in: a known word past its decay date is back to define. */
export function servedStage(w: Pick<WordState, "stage" | "dueAt">, now: number): Stage {
  return w.stage === "known" && w.dueAt !== null && w.dueAt <= now ? "define" : w.stage;
}

/** When a word just defined right for the n-th time decays, or null for never. */
export function decayAt(completions: number, now: number): number | null {
  return completions > DECAY_DAYS.length ? null : now + DECAY_DAYS[completions - 1] * DAY_MS;
}

/**
 * Where a word goes after an answer in the stage it was served in. firstSight: the intro answer
 * on a word never seen before, which decides how many games it needs.
 */
export function advance(w: WordState, served: Stage, correct: boolean, now: number, firstSight = false): WordState {
  if (!correct) {
    // A miss never moves a word back, except a decayed word, which stays in define.
    const failed = { ...w, failCount: w.failCount + 1, failedAt: w.failedAt ?? now };
    return served === "define" && w.stage === "known" ? { ...failed, stage: "define", dueAt: now } : failed;
  }
  switch (served) {
    case "intro":
      return { ...w, stage: "games", gamesNeeded: firstSight ? GAMES_FAST : GAMES_FULL, gamesDone: 0, dueAt: now };
    case "games": {
      const gamesDone = w.gamesDone + 1;
      if (gamesDone < w.gamesNeeded) return { ...w, gamesDone };
      return { ...w, stage: "define", gamesDone, dueAt: now + DEFINE_DELAY_MS };
    }
    case "define": {
      const completions = (w.completions ?? 0) + 1;
      return { ...w, stage: "known", completions, dueAt: decayAt(completions, now) };
    }
    case "known":
      return w;
  }
}
