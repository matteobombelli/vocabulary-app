export const REINSERT_MIN = 3;
export const REINSERT_MAX = 5;

/**
 * Puts a failed card back into the remaining queue, REINSERT_MIN to REINSERT_MAX cards later
 * (or at the end when fewer are left). Returns a new array.
 */
export function reinsert<T>(queue: readonly T[], card: T, random: () => number = Math.random): T[] {
  const gap = REINSERT_MIN + Math.floor(random() * (REINSERT_MAX - REINSERT_MIN + 1));
  const at = Math.min(gap, queue.length);
  return [...queue.slice(0, at), card, ...queue.slice(at)];
}
