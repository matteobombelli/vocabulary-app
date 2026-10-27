import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer, AnswerLang, Card } from "../../shared/api";
import { ANSWER_LANG_NAMES, t } from "../strings";

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
    <div className="card space-y-5">
      <div>
        {label && <p className="text-xs font-semibold tracking-wide text-accent uppercase">{label}</p>}
        <h2 className="mt-1 text-4xl font-semibold tracking-tight break-words">{card.lemma}</h2>
        <p className="mt-1 text-sm text-muted italic">{card.pos.split(",").join(", ")}</p>
      </div>

      {card.kind === "typed" ? (
        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm text-muted" htmlFor="answer">
            {t.whatDoesItMean} {t.answerIn(ANSWER_LANG_NAMES[answerLang])}
          </label>
          <input
            id="answer"
            ref={inputRef}
            autoComplete="off"
            placeholder={t.typeDefinition}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
              {t.submit}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => onAnswer({ kind: "dontknow" })}>
              {t.dontKnow}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t.whatDoesItMean}</p>
          {card.options!.map((option, i) => (
            <button
              key={option}
              type="button"
              className="btn w-full justify-start text-left font-normal"
              disabled={busy}
              onClick={() => onAnswer({ kind: "choice", answer: option })}
            >
              <span className="w-4 shrink-0 text-xs text-muted">{i + 1}</span>
              <span>{option}</span>
            </button>
          ))}
          <button type="button" className="btn w-full justify-start text-muted" disabled={busy} onClick={() => onAnswer({ kind: "dontknow" })}>
            <span className="w-4 shrink-0 text-xs">0</span>
            {t.dontKnow}
          </button>
        </div>
      )}
    </div>
  );
}
