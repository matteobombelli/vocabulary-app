import { useEffect, useRef } from "react";
import type { AnswerResult } from "../../shared/api";
import { VERDICT_LABELS, t } from "../strings";

/** Shown after every answer, whatever the verdict: the verdict, feedback, definitions, example. */
export function AnswerPanel({ lemma, result, onContinue }: { lemma: string; result: AnswerResult; onContinue(): void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus(), [result]);

  return (
    <div className="question">
      <div className="verdict">
        <h2 className="lemma">{lemma}</h2>
        <span className={`badge badge--${result.verdict}`}>{VERDICT_LABELS[result.verdict]}</span>
      </div>
      {result.feedback && <p>{result.feedback}</p>}

      <section>
        <h3 className="group-label">{t.definition}</h3>
        <div className="group">
          <p className="group__row--block">{result.definition}</p>
        </div>
      </section>
      {result.glosses.length > 0 && (
        <section>
          <h3 className="group-label">{t.dictionary}</h3>
          <div className="group">
            <ol className="glosses group__row--block">
              {result.glosses.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ol>
          </div>
        </section>
      )}
      {result.example && (
        <section>
          <h3 className="group-label">{t.example}</h3>
          <div className="group">
            <p className="example group__row--block">{result.example}</p>
          </div>
        </section>
      )}

      {/* Kept within reach on a phone, however long the definitions above it. */}
      <div className="sticky-action">
        <button ref={buttonRef} type="button" className="button--primary button--wide" onClick={onContinue}>
          {t.continue}
        </button>
      </div>
    </div>
  );
}
