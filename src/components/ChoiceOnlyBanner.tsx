import type { Status } from "../../shared/api";
import { t } from "../strings";

export function ChoiceOnlyBanner({ status }: { status: Status | null }) {
  if (!status?.reason) return null;
  return <p className="notice">{t.choiceOnly[status.reason]}</p>;
}
