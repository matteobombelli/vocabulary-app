// Leitner scheduling. Box 1-5 waits INTERVAL_DAYS[box - 1] before the word is due again; box 0
// is "learning" (failed, due straight away at the start of the next session).

export const INTERVAL_DAYS = [1, 3, 7, 14, 30];
export const MAX_BOX = INTERVAL_DAYS.length;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Schedule {
  status: "known" | "learning";
  box: number;
  dueAt: number;
}

/** Where a word goes after an answer. prevBox is null for a word never studied. */
export function schedule(prevBox: number | null, correct: boolean, now: number): Schedule {
  if (!correct) return { status: "learning", box: 0, dueAt: now };
  const box = prevBox === null || prevBox < 1 ? 1 : Math.min(prevBox + 1, MAX_BOX);
  return { status: "known", box, dueAt: now + INTERVAL_DAYS[box - 1] * DAY_MS };
}
