import { describe, expect, it } from "vitest";
import type { PairWord, SessionWord } from "../../shared/api";
import type { Level } from "../../shared/levels";
import { WORKING_SET, applyResults, clozeMatches, createEngine, nextItem, type Engine, type Item } from "../../shared/session";
import { fixtureGames } from "../fixtures/words";

// A deterministic random source.
function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function word(id: number, over: Partial<SessionWord> = {}): SessionWord {
  const lemma = `w${id}`;
  return {
    wordId: id,
    lemma,
    pos: "noun",
    rank: id,
    stage: "intro",
    isNew: true,
    decayed: false,
    gamesNeeded: 3,
    gamesDone: 0,
    failCount: 0,
    options: [`${lemma} def`, "a", "b", "c"],
    definition: `${lemma} def`,
    glosses: [],
    example: "",
    games: fixtureGames(lemma, id),
    ...over,
  };
}

const known: PairWord[] = [1, 2, 3, 4].map((i) => ({ wordId: 100 + i, lemma: `k${i}`, synonyms: [`k${i}syn`], antonyms: [`k${i}ant`] }));

const ids = (item: Item) => (item.kind === "match" ? item.targets : [item.wordId]);

/** Plays a session to the end, answering with answer(), and returns the items shown. */
function play(e: Engine, answer: (item: Item, wordId: number) => boolean, random = rng()): { items: Item[]; engine: Engine } {
  const items: Item[] = [];
  for (let i = 0; i < 200; i++) {
    const item = nextItem(e, random);
    if (!item) return { items, engine: e };
    items.push(item);
    e = applyResults(
      e,
      item,
      ids(item).map((wordId) => ({ wordId, correct: answer(item, wordId) })),
      0,
      random,
    );
  }
  throw new Error("session did not end");
}

const engine = (words: SessionWord[], level: Level | null = "fluent", choiceOnly = false) => createEngine(words, known, level, choiceOnly);

describe("session engine", () => {
  it("starts every new word with its definition multiple choice and works on a few at a time", () => {
    const e = engine([1, 2, 3, 4, 5, 6].map((i) => word(i)));
    const { items } = play(e, () => true);
    const firstSeen = new Map<number, Item>();
    for (const item of items) for (const id of ids(item)) if (!firstSeen.has(id)) firstSeen.set(id, item);
    for (const item of firstSeen.values()) expect(item).toMatchObject({ kind: "mc", stage: "intro" });
    // The fifth word only comes in once one of the first four is done.
    const fifth = items.findIndex((i) => ids(i).includes(5));
    const startedBefore = new Set(items.slice(0, fifth).flatMap(ids));
    expect(startedBefore.size).toBeLessThanOrEqual(WORKING_SET);
  });

  it("gives a word right first time one game, then leaves define for a later session", () => {
    const { items, engine: end } = play(engine([word(1)]), () => true);
    expect(items.map((i) => i.kind === "mc" ? `mc:${i.stage}` : "game")).toEqual(["mc:intro", "game"]);
    expect(end.stats).toMatchObject({ introduced: 1, gamesWon: 1, completed: 0 });
  });

  it("gives a missed word three different games, and brings misses back a few items later", () => {
    let missedIntro = false;
    const { items } = play(engine([1, 2, 3].map((i) => word(i))), (item, id) => {
      if (id === 1 && item.kind === "mc" && !missedIntro) return !(missedIntro = true);
      return true;
    });
    const gamesFor1 = items.filter((i) => i.kind !== "mc" && ids(i).includes(1));
    expect(gamesFor1).toHaveLength(3);
    const kinds = gamesFor1.map((i) => (i.kind === "match" ? i.game : i.kind));
    expect(new Set(kinds).size).toBe(3);
    const intros = items.map((item, i) => [item, i] as const).filter(([item]) => item.kind === "mc" && ids(item).includes(1));
    expect(intros).toHaveLength(2);
    expect(intros[1][1] - intros[0][1]).toBeGreaterThanOrEqual(3);
  });

  it("never shows the same word twice in a row while another is waiting", () => {
    const { items } = play(engine([1, 2, 3, 4, 5, 6].map((i) => word(i))), () => true);
    // At the very end only one word may be left.
    for (let i = 1; i < items.length - 1; i++) {
      expect(ids(items[i]).some((id) => ids(items[i - 1]).includes(id))).toBe(false);
    }
  });

  it("serves define words as typed definitions, or multiple choice when grading is paused", () => {
    const w = word(1, { stage: "define", isNew: false, decayed: true });
    expect(nextItem(engine([w]), rng())).toMatchObject({ kind: "define", typed: true, options: [] });
    expect(nextItem(engine([w], "fluent", true), rng())).toMatchObject({ kind: "define", typed: false });
    const { engine: end } = play(engine([{ ...w, failCount: 1 }]), () => true);
    expect(end.stats).toMatchObject({ completed: 1, recovered: 1 });
  });

  it("parks a word after missing its definition twice", () => {
    const { items } = play(engine([word(1, { stage: "define", isNew: false })]), () => false);
    expect(items).toHaveLength(2);
  });

  it("builds boards of four pairs from session words and known words", () => {
    const games = (id: number) => ({ ...fixtureGames(`w${id}`, id), usage: null, cloze: null, antonyms: [] });
    const words = [1, 2].map((i) => word(i, { stage: "games", isNew: false, games: games(i) }));
    const item = nextItem(engine(words, "beginner"), rng());
    expect(item).toMatchObject({ kind: "match", game: "synonym" });
    if (item?.kind !== "match") return;
    expect(item.pairs).toHaveLength(4);
    expect(item.targets.sort()).toEqual([1, 2]);
    for (const p of item.pairs) expect(p.right).toBe(`${p.left}syn`);
    expect([...item.rights].sort()).toEqual(item.pairs.map((p) => p.right).sort());
  });

  it("leaves out a known word whose synonyms include another pair's partner", () => {
    const games = { ...fixtureGames("w1", 1), usage: null, cloze: null, antonyms: [], synonyms: ["shared"] };
    const w = word(1, { stage: "games", isNew: false, games });
    const clash: PairWord = { wordId: 200, lemma: "clash", synonyms: ["shared", "clashsyn"], antonyms: [] };
    for (let seed = 1; seed <= 20; seed++) {
      const item = nextItem(createEngine([w], [clash, ...known], "beginner", false), rng(seed));
      if (item?.kind !== "match") throw new Error("expected a board");
      expect(item.pairs.map((p) => p.left)).not.toContain("clash");
    }
  });

  it("falls back to the definition multiple choice for a word without game content", () => {
    const empty = { synonyms: [], antonyms: [], cloze: null, usage: null };
    const w = word(1, { stage: "games", isNew: false, games: empty });
    expect(nextItem(engine([w], "beginner"), rng())).toMatchObject({ kind: "mc", stage: "games" });
    // Fluent learners can still write a sentence.
    expect(nextItem(engine([w], "fluent"), rng())).toMatchObject({ kind: "sentence" });
  });

  it("uses a word bank for beginners and a typed blank otherwise", () => {
    const only = (id: number) => ({ ...fixtureGames(`w${id}`, id), usage: null, synonyms: [], antonyms: [] });
    const w = word(1, { stage: "games", isNew: false, games: only(1) });
    const bank = nextItem(engine([w], "beginner"), rng());
    expect(bank).toMatchObject({ kind: "cloze", typed: false });
    expect(bank?.kind === "cloze" && [...bank.options].sort()).toEqual(["w1", "w1a", "w1e", "w1o"]);
    expect(nextItem(engine([w], "intermediate", true), rng())).toMatchObject({ kind: "cloze", typed: true, options: [] });
  });
});

describe("clozeMatches", () => {
  it("ignores case and accents, and takes the lemma too", () => {
    expect(clozeMatches(" Évoqué ", "évoqué", "évoquer")).toBe(true);
    expect(clozeMatches("evoquer", "évoqué", "évoquer")).toBe(true);
    expect(clozeMatches("évoqués", "évoqué", "évoquer")).toBe(false);
    expect(clozeMatches("", "a", "a")).toBe(false);
  });
});
