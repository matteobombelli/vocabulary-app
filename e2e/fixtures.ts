import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { INVITE_CODE } from "../playwright.config";

export const API = "api";
export const PASSWORD = "correct-horse-battery";

let counter = 0;
export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${counter++}@example.test`;
}

/** Registers through the API; the cookie lands in the request context (and the page, which shares it). */
export async function registerViaApi(request: APIRequestContext, email = uniqueEmail()): Promise<string> {
  const res = await request.post(`${API}/auth/register`, { data: { email, password: PASSWORD, inviteCode: INVITE_CODE } });
  expect(res.status(), await res.text()).toBe(201);
  return email;
}

/** The right answer for a fixture word (test/fixtures/words.ts). */
export function rightAnswer(lemma: string, defLang = "en"): string {
  return `${lemma}ness (${defLang})`;
}

export async function currentLemma(page: Page): Promise<string> {
  return (await page.getByRole("heading", { level: 2 }).textContent())!.trim();
}

export const test = base.extend<{ loggedIn: { email: string } }>({
  loggedIn: async ({ page }, use) => {
    const email = await registerViaApi(page.request);
    await use({ email });
  },
});

export { expect };
