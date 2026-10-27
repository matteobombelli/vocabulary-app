import { useEffect, useRef, useState, type FormEvent } from "react";
import { t } from "../../strings";

interface Props {
  label: string;
  placeholder: string;
  hint?: string;
  // A sentence gets a few lines; a definition or a single word one.
  multiline?: boolean;
  // Waiting for the grader.
  checking: boolean;
  answered: boolean;
  onSubmit(text: string | null): void;
}

/** A typed answer: a definition, a sentence, the word for a blank. */
export function TypedGame({ label, placeholder, hint, multiline, checking, answered, onSubmit }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (text.trim() && !checking && !answered) onSubmit(text.trim());
  }

  const Field = multiline ? "textarea" : "input";
  return (
    <form className={`question__actions${checking ? " is-checking" : ""}`} onSubmit={submit}>
      <div>
        <div className="group">
          <Field
            ref={ref}
            className="group__input"
            aria-label={label}
            autoComplete="off"
            autoCapitalize={multiline ? "sentences" : "off"}
            spellCheck={multiline}
            rows={multiline ? 3 : undefined}
            placeholder={placeholder}
            value={text}
            disabled={checking || answered}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (multiline && e.key === "Enter" && !e.shiftKey) submit(e);
            }}
          />
        </div>
        {hint && <p className="group-hint">{hint}</p>}
      </div>
      {!answered && (
        <>
          <button type="submit" className="button--primary" disabled={checking || !text.trim()}>
            {checking ? t.checking : t.submit}
          </button>
          <button type="button" className="button--plain" disabled={checking} onClick={() => onSubmit(null)}>
            {t.dontKnow}
          </button>
        </>
      )}
    </form>
  );
}
