import { useParams } from "react-router";
import { Lang } from "../shared/api";

/** The course language from the URL, or null for an unknown one. */
export function useLang(): Lang | null {
  const parsed = Lang.safeParse(useParams().lang);
  return parsed.success ? parsed.data : null;
}
