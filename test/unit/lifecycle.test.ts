import { describe, expect, it } from "vitest";
import { DEFINE_DELAY_MS, advance, decayAt, newWordState, servedStage, type WordState } from "../../shared/lifecycle";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const fresh = newWordState(NOW);

describe("advance", () => {
  it("needs one game after a right first sight, three otherwise", () => {
    expect(advance(fresh, "intro", true, NOW, true)).toMatchObject({ stage: "games", gamesNeeded: 1, gamesDone: 0 });
    expect(advance(fresh, "intro", true, NOW, false)).toMatchObject({ stage: "games", gamesNeeded: 3 });
  });

  it("keeps a missed word in its stage and records the first miss", () => {
    const missed = advance(fresh, "intro", false, NOW, true);
    expect(missed).toMatchObject({ stage: "intro", failCount: 1, failedAt: NOW });
    expect(advance(missed, "intro", false, NOW + 1)).toMatchObject({ failCount: 2, failedAt: NOW });
  });

  it("moves to define after the games, due after a delay", () => {
    let w: WordState = advance(fresh, "intro", true, NOW);
    w = advance(w, "games", true, NOW);
    w = advance(w, "games", false, NOW);
    w = advance(w, "games", true, NOW);
    expect(w).toMatchObject({ stage: "games", gamesDone: 2 });
    w = advance(w, "games", true, NOW);
    expect(w).toEqual(expect.objectContaining({ stage: "define", gamesDone: 3, dueAt: NOW + DEFINE_DELAY_MS }));
  });

  it("makes a defined word known, decaying after 7, 14, 30 and 90 days, then never", () => {
    let w: WordState = { ...fresh, stage: "define" };
    for (const [n, days] of [
      [1, 7],
      [2, 14],
      [3, 30],
      [4, 90],
    ]) {
      w = advance(w, "define", true, NOW);
      expect(w).toMatchObject({ stage: "known", completions: n, dueAt: NOW + days * DAY });
    }
    expect(advance(w, "define", true, NOW)).toMatchObject({ completions: 5, dueAt: null });
    expect(decayAt(6, NOW)).toBeNull();
  });

  it("serves a decayed known word as define, and a miss keeps it there", () => {
    const known: WordState = { ...fresh, stage: "known", completions: 2, dueAt: NOW - 1 };
    expect(servedStage(known, NOW)).toBe("define");
    expect(servedStage({ ...known, dueAt: NOW + 1 }, NOW)).toBe("known");
    expect(servedStage({ ...known, dueAt: null }, NOW)).toBe("known");
    expect(advance(known, "define", false, NOW)).toMatchObject({ stage: "define", completions: 2, dueAt: NOW, failedAt: NOW });
    expect(advance(known, "define", true, NOW)).toMatchObject({ stage: "known", completions: 3, dueAt: NOW + 30 * DAY });
  });
});
