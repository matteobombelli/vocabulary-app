import { Check } from "lucide-react";
import { LEVELS, type Level } from "../../shared/levels";
import { LEVEL_NAMES } from "../strings";

/** The four levels as a group of rows, the chosen one ticked. */
export function LevelPicker({ value, onChange }: { value: Level | null; onChange(level: Level): void }) {
  return (
    <div className="group" role="radiogroup">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          className="group__button level"
          onClick={() => onChange(level)}
        >
          <span className="row__body">
            <span className="row__title">{LEVEL_NAMES[level].title}</span>
            <span className="row__subtitle">{LEVEL_NAMES[level].hint}</span>
          </span>
          {value === level && <Check className="level__check" size={20} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
