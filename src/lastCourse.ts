import { Lang } from "../shared/api";

const KEY = "vocab:last-course";

/** The course opened last on this device, so the app reopens where the user was. */
export function lastCourse(): Lang {
  try {
    const parsed = Lang.safeParse(localStorage.getItem(KEY));
    return parsed.success ? parsed.data : "en";
  } catch {
    return "en";
  }
}

export function rememberCourse(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Storage can be unavailable (private mode); the app then opens on English.
  }
}
