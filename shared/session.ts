// The study session engine. The client gets every word of a session up front and this decides
// what comes next, so cards follow each other without a round trip; the server applies the same
// lifecycle (shared/lifecycle.ts) to each answer it records.

import type { GameKind, PairWord, SessionWord } from "./api";
import { GAME_WEIGHTS, clozeTyped, type Game, type Level } from "./levels";
import { advance, type Stage } from "./lifecycle";
import { REINSERT_MAX, REINSERT_MIN } from "./queue";

// Words being worked on at once; the next new word comes in when one is done.
export const WORKING_SET = 4;
export const BOARD_PAIRS = 4;
const MIN_BOARD_PAIRS = 3;
const MAX_BOARD_TARGETS = 3;
// Misses in one session after which a word waits for the next session.
const PARK_AFTER: Record<Stage, number> = { intro: 3, games: 3, define: 2, known: 2 };

export type MatchGame = "synonym" | "antonym";

export interface Pair {
  left: string;
  right: string;
  // The session word this pair practises, or null for a known word filling the board.
  wordId: number | null;
}

export type Item =
  // The definition multiple choice: a word's intro, or a game when the word has no game content.
  | { kind: "mc"; wordId: number; stage: "intro" | "games"; options: string[] }
  | { kind: "usage"; wordId: number; options: string[] }
  | { kind: "cloze"; wordId: number; typed: boolean; options: string[] }
  | { kind: "sentence"; wordId: number }
  | { kind: "match"; game: MatchGame; targets: number[]; pairs: Pair[]; rights: string[] }
  // typed false: grading is paused, so define is the definition multiple choice.
  | { kind: "define"; wordId: number; typed: boolean; options: string[] };

export interface Result {
  wordId: number;
  correct: boolean;
}

interface Tracked {
  word: SessionWord;
  stage: Stage;
  gamesNeeded: number;
  gamesDone: number;
  started: boolean;
  // The next intro answer is the word's first ever.
  firstSight: boolean;
  won: Game[];
  misses: number;
  // The turn before which a missed word does not come back.
  notBefore: number;
  lastTurn: number;
  // Finished for this session: known, waiting for define, or parked after too many misses.
  done: boolean;
}

export interface SessionStats {
  answered: number;
  right: number;
  introduced: number;
  gamesWon: number;
  completed: number;
  // Words completed after a miss, this session or before.
  recovered: number;
}

export interface Engine {
  level: Level | null;
  choiceOnly: boolean;
  words: Tracked[];
  known: PairWord[];
  turn: number;
  last: number[];
  stats: SessionStats;
}

export function createEngine(words: SessionWord[], known: PairWord[], level: Level | null, choiceOnly: boolean): Engine {
  return {
    level,
    choiceOnly,
    known,
    turn: 0,
    last: [],
    stats: { answered: 0, right: 0, introduced: 0, gamesWon: 0, completed: 0, recovered: 0 },
    words: words.map((word) => ({
      word,
      stage: word.stage,
      gamesNeeded: word.gamesNeeded,
      gamesDone: word.gamesDone,
      started: false,
      firstSight: word.isNew,
      won: [],
      misses: 0,
      notBefore: 0,
      lastTurn: -1,
      done: false,
    })),
  };
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** A typed blank is right when it is the expected form or the lemma, ignoring case and accents. */
export function clozeMatches(input: string, answer: string, lemma: string): boolean {
  const x = fold(input);
  return x !== "" && (x === fold(answer) || x === fold(lemma));
}

/** The words of the session still to work on. */
function working(e: Engine): Tracked[] {
  const live = e.words.filter((w) => !w.done);
  const started = live.filter((w) => w.started);
  const next = live.find((w) => !w.started);
  return next && started.length < WORKING_SET ? [...started, next] : started;
}

function available(e: Engine, w: Tracked): Game[] {
  const g = w.word.games;
  const out: Game[] = [];
  if (g.usage) out.push("usage");
  if (g.cloze) out.push("cloze");
  if (g.synonyms.length > 0) out.push("synonym");
  if (g.antonyms.length > 0) out.push("antonym");
  if (!e.choiceOnly) out.push("sentence");
  return out;
}

function weighted<T extends string>(options: T[], weight: (o: T) => number, random: () => number): T | null {
  const total = options.reduce((s, o) => s + weight(o), 0);
  if (total <= 0) return null;
  let r = random() * total;
  for (const o of options) {
    r -= weight(o);
    if (r < 0) return o;
  }
  return options[options.length - 1];
}

/** A synonym or antonym board around w, with other words of the session and known words. */
function board(e: Engine, w: Tracked, game: MatchGame, random: () => number): Item | null {
  const key = game === "synonym" ? "synonyms" : "antonyms";
  const targets = [
    w,
    // Any word of the session already in games can join, started this session or not.
    ...e.words.filter(
      (o) => o !== w && !o.done && o.stage === "games" && o.notBefore <= e.turn && !o.won.includes(game) && o.word.games[key].length > 0,
    ),
  ].slice(0, MAX_BOARD_TARGETS);
  const pairs: Pair[] = [];
  const used = new Set<string>();
  const add = (left: string, options: string[], wordId: number | null) => {
    const fresh = options.filter((r) => !used.has(fold(r)) && fold(r) !== fold(left));
    if (fresh.length === 0 || used.has(fold(left))) return;
    const right = fresh[Math.floor(random() * fresh.length)];
    used.add(fold(left)).add(fold(right));
    pairs.push({ left, right, wordId });
  };
  for (const t of targets) add(t.word.lemma, t.word.games[key], t.word.wordId);
  for (const k of shuffle(e.known, random)) {
    if (pairs.length >= BOARD_PAIRS) break;
    if (!e.words.some((o) => o.word.wordId === k.wordId)) add(k.lemma, k[key], null);
  }
  if (pairs.length < MIN_BOARD_PAIRS || !pairs.some((p) => p.wordId === w.word.wordId)) return null;
  return {
    kind: "match",
    game,
    targets: pairs.flatMap((p) => (p.wordId === null ? [] : [p.wordId])),
    pairs: shuffle(pairs, random),
    rights: shuffle(
      pairs.map((p) => p.right),
      random,
    ),
  };
}

function gameItem(e: Engine, w: Tracked, random: () => number): Item {
  const weights = GAME_WEIGHTS[e.level ?? "fluent"];
  let options = available(e, w).filter((g) => weights[g] > 0);
  const unwon = options.filter((g) => !w.won.includes(g));
  if (unwon.length > 0) options = unwon;
  while (options.length > 0) {
    const game = weighted(options, (g) => weights[g], random)!;
    const { games, wordId } = w.word;
    if (game === "usage") return { kind: "usage", wordId, options: shuffle([games.usage!.correct, ...games.usage!.wrong], random) };
    if (game === "cloze") {
      const typed = clozeTyped(e.level);
      return { kind: "cloze", wordId, typed, options: typed ? [] : shuffle([games.cloze!.answer, ...games.cloze!.bank], random) };
    }
    if (game === "sentence") return { kind: "sentence", wordId };
    const item = board(e, w, game, random);
    if (item) return item;
    options = options.filter((g) => g !== game);
  }
  return { kind: "mc", wordId: w.word.wordId, stage: "games", options: shuffle(w.word.options, random) };
}

/** What to show next, or null when the session is over. */
export function nextItem(e: Engine, random: () => number = Math.random): Item | null {
  const pool = working(e);
  if (pool.length === 0) return null;
  const fresh = pool.filter((w) => !e.last.includes(w.word.wordId));
  const ready = fresh.filter((w) => w.notBefore <= e.turn);
  const candidates = ready.length > 0 ? ready : fresh.length > 0 ? fresh : pool;
  const w = candidates.reduce((best, x) => (x.lastTurn < best.lastTurn ? x : best));
  const { wordId, options } = w.word;
  switch (w.stage) {
    case "intro":
      return { kind: "mc", wordId, stage: "intro", options: shuffle(options, random) };
    case "define":
    case "known":
      return { kind: "define", wordId, typed: !e.choiceOnly, options: e.choiceOnly ? shuffle(options, random) : [] };
    case "games":
      return gameItem(e, w, random);
  }
}

/** The stage and game an item's answers are recorded under. */
export function answerKind(item: Item): { stage: Stage; game: GameKind } {
  switch (item.kind) {
    case "mc":
      return { stage: item.stage, game: "mc" };
    case "define":
      return { stage: "define", game: "define" };
    case "match":
      return { stage: "games", game: item.game };
    default:
      return { stage: "games", game: item.kind };
  }
}

/** The engine after an item was answered: one result per word the item practised. */
export function applyResults(e: Engine, item: Item, results: Result[], now = Date.now(), random: () => number = Math.random): Engine {
  const turn = e.turn + 1;
  const stats = { ...e.stats };
  const { game } = answerKind(item);
  const words = e.words.map((w) => {
    const r = results.find((x) => x.wordId === w.word.wordId);
    if (!r) return w;
    const served = w.stage;
    const next = advance(
      { stage: served, gamesNeeded: w.gamesNeeded, gamesDone: w.gamesDone, completions: 0, dueAt: null, failCount: 0, failedAt: null },
      served,
      r.correct,
      now,
      served === "intro" && w.firstSight,
    );
    const t: Tracked = {
      ...w,
      stage: next.stage,
      gamesNeeded: next.gamesNeeded,
      gamesDone: next.gamesDone,
      started: true,
      firstSight: served === "intro" ? false : w.firstSight,
      lastTurn: turn,
    };
    stats.answered++;
    if (r.correct) {
      stats.right++;
      if (served === "intro") stats.introduced++;
      if (served === "games") {
        stats.gamesWon++;
        if (game !== "mc" && game !== "define") t.won = [...w.won, game];
      }
      if (next.stage === "known") {
        stats.completed++;
        if (w.misses > 0 || w.word.failCount > 0) stats.recovered++;
      }
      t.done = next.stage === "known" || (served === "games" && next.stage === "define");
    } else {
      t.misses = w.misses + 1;
      t.notBefore = turn + REINSERT_MIN + Math.floor(random() * (REINSERT_MAX - REINSERT_MIN + 1));
      t.done = t.misses >= PARK_AFTER[served];
    }
    return t;
  });
  const last = item.kind === "match" ? item.targets : [item.wordId];
  return { ...e, words, turn, last, stats };
}

/** Rough progress through the session: items answered, and items probably left. */
export function progress(e: Engine): { done: number; left: number } {
  const left = e.words
    .filter((w) => !w.done)
    .reduce((s, w) => s + (w.stage === "intro" ? 3 : w.stage === "games" ? w.gamesNeeded - w.gamesDone : 1), 0);
  return { done: e.turn, left };
}

/** Whether the next intro answer for a word is its first ever. */
export function firstSight(e: Engine, wordId: number): boolean {
  return e.words.find((w) => w.word.wordId === wordId)?.firstSight ?? false;
}

export function sessionWord(e: Engine, wordId: number): SessionWord {
  return e.words.find((w) => w.word.wordId === wordId)!.word;
}
