import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_ITEMS,
  bandRange,
  estimateSize,
  fit,
  initialState,
  isDone,
  nextBand,
  record,
  startRank,
  type AssessmentState,
} from "../../shared/assessment";

// Deterministic PRNG so failures reproduce.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_RANK = 60_000;

/**
 * A test-taker who knows every word above rank n, with noise: 5% slips on known words and an 8%
 * lucky guess rate on unknown ones (multiple choice with an "I don't know" option).
 */
function simulate(n: number, seed: number): AssessmentState {
  const random = mulberry32(seed);
  let state = initialState(MAX_RANK);
  while (!isDone(state)) {
    const [lo, hi] = bandRange(nextBand(state), MAX_RANK);
    const rank = lo + Math.floor(random() * (hi - lo + 1));
    state = { ...state, pending: { wordId: rank, rank, kind: "choice" } };
    const knows = rank <= n ? random() > 0.05 : random() < 0.08;
    state = record(state, knows ? 1 : 0);
  }
  return state;
}

describe("assessment", () => {
  it.each([2_000, 5_000, 10_000, 20_000, 30_000, 40_000])("recovers a vocabulary of %i", (n) => {
    const sizes: number[] = [];
    for (let seed = 1; seed <= 9; seed++) {
      const state = simulate(n, seed * 7919 + n);
      expect(state.responses).toHaveLength(ASSESSMENT_ITEMS);
      const f = fit(state.responses, MAX_RANK);
      const size = estimateSize(f, MAX_RANK);
      const start = startRank(f, MAX_RANK);
      sizes.push(size);
      expect(size, `seed ${seed}`).toBeGreaterThan(n * 0.8);
      expect(size, `seed ${seed}`).toBeLessThan(n * 1.25);
      // Learning starts at the edge of what they know, a little before rather than after it.
      expect(start, `seed ${seed}`).toBeLessThan(n * 1.1);
      expect(start, `seed ${seed}`).toBeGreaterThan(n * 0.7);
    }
    const median = sizes.sort((x, y) => x - y)[4];
    expect(median).toBeGreaterThan(n * 0.9);
    expect(median).toBeLessThan(n * 1.1);
  });

  it("gives a finite curve when every answer is right", () => {
    let state = initialState(MAX_RANK);
    while (!isDone(state)) {
      const [lo] = bandRange(nextBand(state), MAX_RANK);
      state = record({ ...state, pending: { wordId: lo, rank: lo, kind: "choice" } }, 1);
    }
    const f = fit(state.responses, MAX_RANK);
    expect(Number.isFinite(f.a) && Number.isFinite(f.b)).toBe(true);
    expect(estimateSize(f, MAX_RANK)).toBeGreaterThan(MAX_RANK * 0.8);
  });

  it("gives a finite curve when every answer is wrong", () => {
    let state = initialState(MAX_RANK);
    while (!isDone(state)) {
      const [lo, hi] = bandRange(nextBand(state), MAX_RANK);
      const rank = Math.round((lo + hi) / 2);
      state = record({ ...state, pending: { wordId: rank, rank, kind: "choice" } }, 0);
    }
    const f = fit(state.responses, MAX_RANK);
    expect(Number.isFinite(f.a) && Number.isFinite(f.b)).toBe(true);
    expect(estimateSize(f, MAX_RANK)).toBeLessThan(1_500);
    expect(startRank(f, MAX_RANK)).toBeLessThan(500);
  });

  it("walks the staircase toward the edge and halves its step on reversals", () => {
    let state = initialState(MAX_RANK);
    const first = state.band;
    state = record({ ...state, pending: { wordId: 1, rank: 1, kind: "choice" } }, 0);
    expect(state.band).toBeLessThan(first);
    const step = state.step;
    state = record({ ...state, pending: { wordId: 2, rank: 2, kind: "choice" } }, 1);
    expect(state.step).toBe(Math.max(1, Math.floor(step / 2)));
  });
});
