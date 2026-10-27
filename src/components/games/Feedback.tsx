import { useEffect, useRef, type ReactNode } from "react";
import type { SessionWord, Verdict } from "../../../shared/api";
import { VERDICT_LABELS, t } from "../../strings";

const AUTO_MS = 900;

interface Props {
  verdict: Verdict;
  // The grader's line, for typed answers.
  feedback?: string | null;
  // What the right answer was, when the game has one beyond the definition.
  answer?: ReactNode;
  // Words whose meaning to show: the one practised, or those missed on a board.
  words: SessionWord[];
  // Show glosses and the example too: a new word's first sight, or a definition.
  teach: boolean;
  // A right answer that teaches nothing new moves on by itself.
  auto: boolean;
  onContinue(): void;
}

/** Shown under a game once it is answered. */
export function Feedback({ verdict, feedback, answer, words, teach, auto, onContinue }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
    if (!auto) return;
    const timer = setTimeout(onContinue, AUTO_MS);
    return () => clearTimeout(timer);
  }, [auto, onContinue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && document.activeElement !== buttonRef.current) onContinue();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onContinue]);

  return (
    <div className="feedback">
      <div className="verdict">
        <span className={`badge badge--${verdict}`}>{VERDICT_LABELS[verdict]}</span>
        {feedback && <p className="feedback__line">{feedback}</p>}
      </div>
      {answer && (
        <section>
          <h3 className="group-label">{t.rightAnswer}</h3>
          <div className="group">
            <div className="group__row--block">{answer}</div>
          </div>
        </section>
      )}
      {!auto &&
        words.map((w) => (
          <section key={w.wordId}>
            <h3 className="group-label">{words.length > 1 ? w.lemma : t.definition}</h3>
            <div className="group">
              <p className="group__row--block">{w.definition}</p>
              {teach && w.glosses.length > 0 && (
                <ol className="glosses group__row--block">
                  {w.glosses.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ol>
              )}
              {teach && w.example && <p className="example group__row--block">{w.example}</p>}
            </div>
          </section>
        ))}
      <div className="sticky-action">
        <button ref={buttonRef} type="button" className={`button--primary button--wide${auto ? " button--auto" : ""}`} onClick={onContinue}>
          {t.continue}
        </button>
      </div>
    </div>
  );
}
