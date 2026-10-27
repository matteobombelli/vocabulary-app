import { t } from "../strings";

export function Spinner() {
  return <span className="spinner" role="status" aria-label={t.loading} />;
}
