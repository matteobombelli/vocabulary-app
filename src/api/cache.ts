// Stale-while-revalidate for page data: a page renders the last value it saw straight away and
// refreshes it in the background, so moving between pages shows no spinner after the first visit.

import { useCallback, useEffect, useState } from "react";
import type { Course, Lang, StudySession } from "../../shared/api";
import { courses, study } from "./endpoints";

const store = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
  listeners.get(key)?.forEach((f) => f());
}

export function useCached<T>(key: string | null, load: () => Promise<T>): { data: T | undefined; error: boolean; reload(): void } {
  const [, bump] = useState(0);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    if (!key) return;
    setError(false);
    load().then(
      (v) => setCached(key, v),
      () => setError(true),
    );
    // load is a fresh closure every render; the key names what it loads.
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const f = () => bump((n) => n + 1);
    const set = listeners.get(key) ?? new Set();
    set.add(f);
    listeners.set(key, set);
    reload();
    return () => void set.delete(f);
  }, [key, reload]);

  return { data: key ? (store.get(key) as T | undefined) : undefined, error, reload };
}

export const courseKey = (lang: Lang) => `course:${lang}`;

export function useCourse(lang: Lang | null) {
  return useCached<Course>(lang && courseKey(lang), () => courses.get(lang!));
}

// Study answers are saved one after another, across pages: a study page left mid-session keeps
// saving after it unmounts, and a new session is fetched only once those answers have landed.
let answers: Promise<unknown> = Promise.resolve();

/** Queues a save behind every earlier one; the returned promise settles with it. */
export function queueAnswer<T>(send: () => Promise<T>): Promise<T> {
  const p = answers.then(send);
  answers = p.catch(() => undefined);
  return p;
}

/** Settles once every answer queued so far has been saved or given up on. */
export function answersSaved(): Promise<unknown> {
  return answers;
}

// A session is used once, so it is prefetched rather than cached: the course page starts loading
// it, and the study page takes it if it is recent enough.
const SESSION_TTL_MS = 60_000;
const sessions = new Map<Lang, { at: number; promise: Promise<StudySession> }>();

export function prefetchSession(lang: Lang): void {
  const p = sessions.get(lang);
  if (p && Date.now() - p.at < SESSION_TTL_MS) return;
  const promise = answersSaved().then(() => study.session(lang));
  promise.catch(() => sessions.delete(lang));
  sessions.set(lang, { at: Date.now(), promise });
}

export function takeSession(lang: Lang): Promise<StudySession> {
  const p = sessions.get(lang);
  sessions.delete(lang);
  return p && Date.now() - p.at < SESSION_TTL_MS ? p.promise : answersSaved().then(() => study.session(lang));
}

/** Drops a prefetched session, after answers that would change what it holds. */
export function dropSession(lang: Lang): void {
  sessions.delete(lang);
}
