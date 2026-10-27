// Adaptive vocabulary assessment: picks which frequency band to test next, then fits
// P(known) = sigmoid(a + b * ln(rank)) to the answers.

export const BAND_SIZE = 2500;
export const ASSESSMENT_ITEMS = 50;
// Every TYPED_EVERY-th item is a typed definition (when grading is available), so recognising
// the right option is not enough to pass.
export const TYPED_EVERY = 5;
// Items spent on the staircase before sampling around the fitted curve.
const STAIRCASE_ITEMS = 16;
// Band offsets around the fitted 50% point, cycled once the staircase is done. Wide offsets
// pin down the slope, band 0 anchors the easy end.
const SPREAD = [0, -1, 1, -3, 3, -6, 6, -2, 2, "first", -10, 10] as const;
export const START_THRESHOLD = 0.8;

export interface Response {
  rank: number;
  // 1 right, 0 wrong or "I don't know", 0.5 a partially right typed definition.
  score: number;
  // Multiple choice, where a right answer may be a lucky guess.
  choice: boolean;
}

// Chance that someone who does not know a word still picks the right option. Honest test-takers
// press "I don't know", so this sits well under the 1-in-4 of a blind guess.
export const GUESS_RATE = 0.1;
// Chance of missing a word one does know (a slip, a misread option).
export const SLIP_RATE = 0.05;

export interface AssessmentState {
  maxRank: number;
  responses: Response[];
  asked: number[];
  // The card waiting for an answer.
  pending: { wordId: number; rank: number; kind: "typed" | "choice" } | null;
  band: number;
  step: number;
  // +1 after moving to rarer bands, -1 after moving to commoner ones, 0 before the first move.
  lastMove: number;
}

export interface Fit {
  a: number;
  b: number;
}

export function bandCount(maxRank: number): number {
  return Math.max(1, Math.ceil(maxRank / BAND_SIZE));
}

export function bandRange(band: number, maxRank: number): [number, number] {
  return [band * BAND_SIZE + 1, Math.min((band + 1) * BAND_SIZE, maxRank)];
}

/** A fresh assessment; the staircase starts at band (the middle when none is given). */
export function initialState(maxRank: number, band?: number): AssessmentState {
  const bands = bandCount(maxRank);
  return {
    maxRank,
    responses: [],
    asked: [],
    pending: null,
    band: band ?? Math.floor(bands / 2),
    step: Math.max(1, Math.round(bands / 4)),
    lastMove: 0,
  };
}

const clampBand = (band: number, maxRank: number) => Math.min(Math.max(band, 0), bandCount(maxRank) - 1);

/** Records an answer to the pending item and moves the staircase. Returns a new state. */
export function record(state: AssessmentState, score: number): AssessmentState {
  if (!state.pending) throw new Error("no pending item");
  const responses = [...state.responses, { rank: state.pending.rank, score, choice: state.pending.kind === "choice" }];
  let { band, step, lastMove } = state;
  if (responses.length <= STAIRCASE_ITEMS) {
    const move = score >= 0.5 ? 1 : -1;
    if (lastMove !== 0 && move !== lastMove) step = Math.max(1, Math.floor(step / 2));
    band = clampBand(band + move * step, state.maxRank);
    lastMove = move;
  }
  return { ...state, responses, pending: null, band, step, lastMove };
}

export function isDone(state: AssessmentState): boolean {
  return state.responses.length >= ASSESSMENT_ITEMS;
}

/** The band the next item comes from. */
export function nextBand(state: AssessmentState): number {
  const n = state.responses.length;
  if (n < STAIRCASE_ITEMS) return state.band;
  const offset = SPREAD[(n - STAIRCASE_ITEMS) % SPREAD.length];
  if (offset === "first") return 0;
  const center = rankBand(rankAt(fit(state.responses, state.maxRank), 0.5, state.maxRank));
  return clampBand(center + offset, state.maxRank);
}

export function itemKind(index: number, choiceOnly: boolean): "typed" | "choice" {
  return !choiceOnly && index % TYPED_EVERY === TYPED_EVERY - 1 ? "typed" : "choice";
}

const rankBand = (rank: number) => Math.floor((rank - 1) / BAND_SIZE);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Fits the knowledge curve, correcting for guesses and slips by EM: a right multiple-choice
 * answer counts as known only with the posterior probability that it was not a lucky guess, a
 * wrong answer as unknown only with the probability that it was not a slip, and the curve is
 * refitted until those probabilities settle.
 */
export function fit(responses: readonly Response[], maxRank: number): Fit {
  let f = logistic(responses, maxRank);
  for (let iter = 0; iter < 30; iter++) {
    const weighted = responses.map((r) => {
      const p = pKnown(f, r.rank);
      if (r.score === 0) return { ...r, score: (p * SLIP_RATE) / (p * SLIP_RATE + (1 - p) * (1 - (r.choice ? GUESS_RATE : 0))) };
      if (!r.choice) return r;
      return { ...r, score: (p * (1 - SLIP_RATE)) / (p * (1 - SLIP_RATE) + (1 - p) * GUESS_RATE) };
    });
    const next = logistic(weighted, maxRank);
    const settled = Math.abs(next.a - f.a) < 1e-6 && Math.abs(next.b - f.b) < 1e-6;
    f = next;
    if (settled) break;
  }
  return f;
}

/**
 * Logistic regression of score on ln(rank) by Newton's method. Two pseudo-observations anchor
 * it (the most frequent word is known, a word far past the end of the list is not), so a
 * test-taker who gets everything right or wrong still gets a finite curve.
 */
function logistic(responses: readonly Pick<Response, "rank" | "score">[], maxRank: number): Fit {
  const data = [...responses, { rank: 1, score: 1 }, { rank: maxRank * 4, score: 0 }];
  // Centring ln(rank) keeps the Newton steps well conditioned; a is shifted back at the end.
  const xs = data.map((d) => Math.log(d.rank));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const RIDGE = 1e-3;
  const logLik = (a: number, b: number) =>
    data.reduce((s, { score }, i) => {
      const p = Math.min(Math.max(sigmoid(a + b * (xs[i] - mean)), 1e-12), 1 - 1e-12);
      return s + score * Math.log(p) + (1 - score) * Math.log(1 - p);
    }, 0) -
    (RIDGE / 2) * (a * a + b * b);

  let a = 0;
  let b = 0;
  let current = logLik(a, b);
  for (let iter = 0; iter < 100; iter++) {
    let ga = -RIDGE * a;
    let gb = -RIDGE * b;
    let haa = RIDGE;
    let hab = 0;
    let hbb = RIDGE;
    data.forEach(({ score }, i) => {
      const x = xs[i] - mean;
      const p = sigmoid(a + b * x);
      const w = p * (1 - p);
      ga += score - p;
      gb += (score - p) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    });
    const det = haa * hbb - hab * hab;
    let da = (hbb * ga - hab * gb) / det;
    let db = (haa * gb - hab * ga) / det;
    // Halve the step until the likelihood improves, so separable data cannot overshoot.
    let next = logLik(a + da, b + db);
    for (let k = 0; k < 30 && next < current; k++) {
      da /= 2;
      db /= 2;
      next = logLik(a + da, b + db);
    }
    if (next < current) break;
    a += da;
    b += db;
    current = next;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
  }
  return { a: a - b * mean, b };
}

export function pKnown(f: Fit, rank: number): number {
  return sigmoid(f.a + f.b * Math.log(rank));
}

/** The rank where P(known) crosses p, clamped to the list. */
export function rankAt(f: Fit, p: number, maxRank: number): number {
  if (f.b >= 0) return p > pKnown(f, 1) ? 1 : maxRank;
  const r = Math.exp((Math.log(p / (1 - p)) - f.a) / f.b);
  return Math.min(Math.max(Math.round(r), 1), maxRank);
}

/** Expected number of known words: the sum of P(known) over the whole list. */
export function estimateSize(f: Fit, maxRank: number): number {
  let sum = 0;
  for (let r = 1; r <= maxRank; r++) sum += pKnown(f, r);
  return Math.round(sum);
}

/** Where learning starts: the first rank with P(known) below START_THRESHOLD. */
export function startRank(f: Fit, maxRank: number): number {
  return rankAt(f, START_THRESHOLD, maxRank);
}
