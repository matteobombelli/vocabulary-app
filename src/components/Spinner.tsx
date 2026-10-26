import { t } from "../strings";

export function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label={t.loading}>
      <span className="size-6 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  );
}
