import { describe, expect, it } from "vitest";
import { INTERVAL_DAYS, schedule } from "../../shared/leitner";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("schedule", () => {
  it("puts a new word answered right in box 1, due in a day", () => {
    expect(schedule(null, true, NOW)).toEqual({ status: "known", box: 1, dueAt: NOW + DAY });
  });

  it("moves a learning word answered right to box 1", () => {
    expect(schedule(0, true, NOW)).toEqual({ status: "known", box: 1, dueAt: NOW + DAY });
  });

  it("moves up one box per right answer with the box's interval", () => {
    for (let box = 1; box < INTERVAL_DAYS.length; box++) {
      expect(schedule(box, true, NOW)).toEqual({ status: "known", box: box + 1, dueAt: NOW + INTERVAL_DAYS[box] * DAY });
    }
  });

  it("stays in the last box", () => {
    expect(schedule(5, true, NOW)).toEqual({ status: "known", box: 5, dueAt: NOW + 30 * DAY });
  });

  it("drops a wrong answer back to learning, due now", () => {
    for (const box of [null, 0, 1, 3, 5]) {
      expect(schedule(box, false, NOW)).toEqual({ status: "learning", box: 0, dueAt: NOW });
    }
  });
});
