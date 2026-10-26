import { useEffect, useRef } from "react";
import type { AnswerResult } from "../../shared/api";
import { VERDICT_LABELS, t } from "../strings";

const VERDICT_STYLES = {
  correct: "bg-good-soft text-good",
  partial: "bg-warn-soft text-warn",
  incorrect: "bg-bad-soft text-bad",
};

/** Shown after every answer, whatever the verdict: the verdict, feedback, definitions, example. */
export function AnswerPanel({ lemma, result, onContinue }: { lemma: string; result: AnswerResult; onContinue(): void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus(), [result]);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-3xl font-semibold tracking-tight break-words">{lemma}</h2>
        <span className={`rounded-full px-3 py-0.5 text-sm font-medium ${VERDICT_STYLES[result.verdict]}`}>
          {VERDICT_LABELS[result.verdict]}
        </span>
      </div>
      {result.feedback && <p>{result.feedback}</p>}
      <section>
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t.definition}</h3>
        <p className="mt-1 text-lg">{result.definition}</p>
      </section>
      {result.glosses.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t.dictionary}</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {result.glosses.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ol>
        </section>
      )}
      {result.example && (
        <section>
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t.example}</h3>
          <p className="mt-1 italic">{result.example}</p>
        </section>
      )}
      <button ref={buttonRef} type="button" className="btn btn-primary" onClick={onContinue}>
        {t.continue}
      </button>
    </div>
  );
}
