import { useEffect, useRef, useState } from "react";
import type { Pair } from "../../../shared/session";

const WRONG_MS = 450;

interface Props {
  pairs: Pair[];
  rights: string[];
  // Called once every pair is matched, with the session words that were part of a wrong match.
  onDone(missed: Set<number>): void;
}

/** A board of words and their synonyms (or opposites): tap one on each side to match them. */
export function MatchGame({ pairs, rights, onDone }: Props) {
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<{ left: string; right: string } | null>(null);
  const missed = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function choose(side: "left" | "right", text: string) {
    const l = side === "left" ? (left === text ? null : text) : left;
    const r = side === "right" ? (right === text ? null : text) : right;
    if (l === null || r === null) {
      setLeft(l);
      setRight(r);
      return;
    }
    setLeft(null);
    setRight(null);
    const pair = pairs.find((p) => p.left === l)!;
    if (pair.right === r) {
      const next = new Set(matched).add(l);
      setMatched(next);
      if (next.size === pairs.length) onDone(missed.current);
      return;
    }
    // A wrong match counts against both session words it involved.
    const other = pairs.find((p) => p.right === r)!;
    for (const id of [pair.wordId, other.wordId]) if (id !== null) missed.current.add(id);
    setWrong({ left: l, right: r });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setWrong(null), WRONG_MS);
  }

  const rightMatched = (r: string) => pairs.some((p) => p.right === r && matched.has(p.left));
  const tile = (side: "left" | "right", text: string, done: boolean) => {
    const selected = side === "left" ? left === text : right === text;
    const isWrong = wrong !== null && wrong[side] === text;
    const state = done ? " tile--matched" : isWrong ? " tile--wrong" : selected ? " tile--selected" : "";
    return (
      <button
        key={text}
        type="button"
        className={`tile${state}`}
        disabled={done}
        aria-pressed={selected}
        onClick={() => choose(side, text)}
      >
        {text}
      </button>
    );
  };

  return (
    <div className="board">
      <div className="board__col">{pairs.map((p) => tile("left", p.left, matched.has(p.left)))}</div>
      <div className="board__col">{rights.map((r) => tile("right", r, rightMatched(r)))}</div>
    </div>
  );
}
