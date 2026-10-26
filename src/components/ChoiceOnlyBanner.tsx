import type { Status } from "../../shared/api";
import { t } from "../strings";

export function ChoiceOnlyBanner({ status }: { status: Status | null }) {
  if (!status?.reason) return null;
  return <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">{t.choiceOnly[status.reason]}</p>;
}
