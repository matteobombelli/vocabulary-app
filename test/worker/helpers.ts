import { env, exports } from "cloudflare:workers";
import type { Lang } from "../../shared/api";
import { INSERT_WORD, LANG_BASE, fixtureWords, wordValues } from "../fixtures/words";

interface TestUser {
  id: string;
  email: string;
}

export const API = "https://apps.matteob.dev/projects/vocabulary-app/api";

export function request(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(API + path, init));
}

export function cookieHeader(cookie: string): Record<string, string> {
  return { Cookie: cookie };
}

export function jsonRequest(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  return request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The "vocab_session=<value>" pair from a Set-Cookie header, ready to send back as Cookie. */
export function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on response");
  const pair = setCookie.split(";")[0];
  if (!pair.startsWith("vocab_session=")) throw new Error(`unexpected Set-Cookie: ${setCookie}`);
  return pair;
}

export async function registerAndLogin(
  email = "u1@example.com",
  password = "password123",
): Promise<{ cookie: string; user: TestUser }> {
  const res = await jsonRequest("/auth/register", "POST", {
    email,
    password,
    inviteCode: "dev-invite",
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const cookie = sessionCookie(res);
  const { user } = (await res.json()) as { user: TestUser };
  return { cookie, user };
}

/** Loads synthetic words (test/fixtures/words.ts) into the test database. */
export async function seedWords(lang: Lang, count: number): Promise<void> {
  const statements = fixtureWords(lang, count).map((w) => env.DB.prepare(INSERT_WORD).bind(...wordValues(w)));
  for (let i = 0; i < statements.length; i += 500) await env.DB.batch(statements.slice(i, i + 500));
}

export function wordId(lang: Lang, rank: number): number {
  return LANG_BASE[lang] + rank;
}

/** The right option, or the right typed answer, for a fixture word. */
export function rightAnswer(lemma: string, defLang: Lang = "en"): string {
  return `${lemma}ness (${defLang})`;
}
