import type { CSSProperties } from "react";

interface Props<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}

/** Equal-width options with an indicator that slides to the chosen one. */
export function Segmented<T extends string>({ label, options, value, onChange }: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
