import { Check, X } from "lucide-react";
import { useEffect } from "react";
import { t } from "../../strings";

interface Props {
  label: string;
  options: string[];
  correct: string;
  // undefined until answered; null for "I don't know".
  picked: string | null | undefined;
  onPick(option: string | null): void;
}

/** Options to pick one from: a meaning, a sentence, a word for a blank. 1-4 pick, 0 is "I don't know". */
export function ChoiceGame({ label, options, correct, picked, onPick }: Props) {
  const answered = picked !== undefined;

  useEffect(() => {
    if (answered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
      const n = Number(e.key);
      if (e.key === "0") onPick(null);
      else if (n >= 1 && n <= options.length) onPick(options[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, options, onPick]);

  return (
    <div className="question__actions">
      <div>
        <p className="group-label">{label}</p>
        <div className="group group--options">
          {options.map((option, i) => {
            const state = !answered ? "" : option === correct ? "option--right" : option === picked ? "option--wrong" : "option--dim";
            return (
              <button
                key={option}
                type="button"
                className={`group__button option ${state}`}
                disabled={answered}
                onClick={() => onPick(option)}
              >
                <span className="option__key">{i + 1}</span>
                <span className="option__text">{option}</span>
                {state === "option--right" && <Check className="option__mark" size={18} aria-label={t.rightAnswer} />}
                {state === "option--wrong" && <X className="option__mark" size={18} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
      {!answered && (
        <button type="button" className="button--plain" onClick={() => onPick(null)}>
          {t.dontKnow}
        </button>
      )}
    </div>
  );
}
