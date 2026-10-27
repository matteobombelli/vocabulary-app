import { currentLemma, expect, rightAnswer, test } from "./fixtures";

test("learn: a missed word comes back a few cards later", async ({ page, loggedIn }) => {
  void loggedIn;
  await page.goto("en");
  await page.getByRole("button", { name: "Start from the most common words" }).click();
  await expect(page).toHaveURL(/\/en\/learn$/);

  const missed = await currentLemma(page);
  await page.getByRole("button", { name: "I don't know" }).click();
  await expect(page.getByText("Not quite")).toBeVisible();
  await expect(page.getByText(rightAnswer(missed)).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    const lemma = await currentLemma(page);
    if (lemma === missed) break;
    seen.push(lemma);
    await page.getByLabel(/What does it mean/).fill(rightAnswer(lemma));
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByText("Correct", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  expect(seen.length).toBeGreaterThanOrEqual(3);
  expect(seen.length).toBeLessThanOrEqual(5);
  await expect(page.getByText("Again")).toBeVisible();
  expect(await currentLemma(page)).toBe(missed);

  await page.goto("en/words");
  await expect(page.getByText(seen[0], { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Learning" }).click();
  await expect(page.getByText(missed, { exact: true })).toBeVisible();
});

test("settings: French definitions can be shown in English", async ({ page, loggedIn }) => {
  void loggedIn;
  await page.goto("settings");
  const english = page.getByRole("radiogroup", { name: "Definitions" }).getByRole("radio", { name: "English" });
  await english.click();
  await expect(english).toHaveAttribute("aria-checked", "true");

  await page.goto("fr");
  await page.getByRole("button", { name: "Start from the most common words" }).click();
  const lemma = await currentLemma(page);
  await page.getByRole("button", { name: "I don't know" }).click();
  await expect(page.getByText(rightAnswer(lemma, "en")).first()).toBeVisible();
});

test("assessment: questions advance with progress", async ({ page, loggedIn }) => {
  void loggedIn;
  await page.goto("en/assessment");
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page.getByText("1 of 50")).toBeVisible();
  await page.keyboard.press("0");
  await expect(page.getByText("Not quite")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("2 of 50")).toBeVisible();
});

test("deep links render the SPA (404.html fallback)", async ({ page, loggedIn }) => {
  void loggedIn;
  const res = await page.goto("en/words");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Your words" })).toBeVisible();
});
