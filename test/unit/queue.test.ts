import { describe, expect, it } from "vitest";
import { reinsert } from "../../shared/queue";

describe("reinsert", () => {
  const queue = ["a", "b", "c", "d", "e", "f", "g"];

  it("puts the card 3 to 5 places later", () => {
    expect(reinsert(queue, "x", () => 0)).toEqual(["a", "b", "c", "x", "d", "e", "f", "g"]);
    expect(reinsert(queue, "x", () => 0.99)).toEqual(["a", "b", "c", "d", "e", "x", "f", "g"]);
  });

  it("appends when fewer cards are left", () => {
    expect(reinsert(["a"], "x", () => 0.5)).toEqual(["a", "x"]);
    expect(reinsert([], "x", () => 0.5)).toEqual(["x"]);
  });

  it("does not modify the input", () => {
    const copy = [...queue];
    reinsert(queue, "x");
    expect(queue).toEqual(copy);
  });
});
