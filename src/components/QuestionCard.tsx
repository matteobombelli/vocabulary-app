import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer, AnswerLang, Card } from "../../shared/api";
import { t } from "../strings";

interface Props {
  card: Card;
  answerLang: AnswerLang;
  busy: boolean;
  label?: string;
  onAnswer(answer: Omit<Answer, "wordId">): void;
}

/** The word and a way to answer: a typed definition, or one of the options. */
export function QuestionCard({ card, answerLang, busy, label, onAnswer }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText("");
    inputRef.current?.focus();
  }, [card]);

  // 1-4 pick an option, 0 is "I don't know".
  useEffect(() => {
    if (card.kind !== "choice") return;
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (e.key === "0") onAnswer({ kind: "dontknow" });
      else if (n >= 1 && n <= (card.options?.length ?? 0)) onAnswer({ kind: "choice", answer: card.options![n - 1] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, busy, onAnswer]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) onAnswer({ kind: "typed", answer: text.trim() });
  }

  return (
    <div className="question">
      <div>
        {label && <p className="question__label">{label}</p>}
        <h2 className="lemma">{card.lemma}</h2>
        <p className="lemma__pos">{card.pos.split(",").join(", ")}</p>
      </div>

      {card.kind === "typed" ? (
        <form className="question__actions" onSubmit={onSubmit}>
          <div>
            <div className="group">
              <input
                ref={inputRef}
                className="group__input"
                aria-label={t.whatDoesItMean}
                autoComplete="off"
                autoCapitalize="off"
                placeholder={t.typeDefinition}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <p className="group-hint">{t.answerIn(answerLang)}</p>
          </div>
          <button type="submit" className="button--primary" disabled={busy || !text.trim()}>
            {t.submit}
          </button>
          <button type="button" className="button--plain" disabled={busy} onClick={() => onAnswer({ kind: "dontknow" })}>
            {t.dontKnow}
          </button>
        </form>
      ) : (
        <div className="question__actions">
          <div>
            <p className="group-label">{t.whatDoesItMean}</p>
            <div className="group group--options">
              {card.options!.map((option, i) => (
                <button
                  key={option}
                  type="button"
                  className="group__button"
                  disabled={busy}
                  onClick={() => onAnswer({ kind: "choice", answer: option })}
                >
                  <span className="option__key">{i + 1}</span>
                  <span className="option__text">{option}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="button--plain" disabled={busy} onClick={() => onAnswer({ kind: "dontknow" })}>
            {t.dontKnow}
          </button>
        </div>
      )}
    </div>
  );
}
