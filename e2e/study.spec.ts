import type { Page } from "@playwright/test";
import { currentLemma, expect, lemmaFor, rightAnswer, test } from "./fixtures";

/** Answers whatever card is showing, rightly, using what the fixture words are made of. */
async function answerRight(page: Page) {
  const label = (await page.locator(".question__label").textContent())!.trim();
  if (label.startsWith("Match")) {
    const tiles = page.locator(".board__col").first().locator(".tile");
    for (const left of await tiles.allTextContents()) {
      await page.getByRole("button", { name: left, exact: true }).click();
      const suffix = label.includes("synonyms") ? "syn" : "ant";
      await page.getByRole("button", { name: `${left}${suffix}`, exact: true }).click();
    }
    return;
  }
  if (label === "Fill in the blank") {
    const rank = Number((await page.locator(".cloze").first().textContent())!.match(/gate (\d+)/)![1]);
    const lemma = lemmaFor("en", rank);
    const input = page.getByLabel("Type the missing word");
    if (await input.count()) {
      await input.fill(lemma);
      await page.getByRole("button", { name: "Check" }).click();
    } else await page.getByRole("button", { name: lemma, exact: true }).click();
    return;
  }
  const lemma = await currentLemma(page);
  if (label === "Correct usage") await page.getByRole("button", { name: /Right:/ }).click();
  else if (label === "Use it in a sentence") {
    await page.getByLabel("Write a sentence that uses it").fill(`We saw the ${lemma} by the river.`);
    await page.getByRole("button", { name: "Check" }).click();
  } else if (label === "Define it" || label === "Refresh") {
    await page.getByLabel("What does it mean?").fill(rightAnswer(lemma));
    await page.getByRole("button", { name: "Check" }).click();
  } else await page.getByRole("button", { name: rightAnswer(lemma) }).click();
}

test("study: pick a level, and a missed word comes back", async ({ page, loggedIn }) => {
  void loggedIn;
  await page.goto("en");
  await page.getByRole("radio", { name: /Beginner/ }).click();
  await page.getByRole("button", { name: "Start from the most common words" }).click();
  await expect(page).toHaveURL(/\/en\/study$/);

  await expect(page.locator(".question__label")).toHaveText("New word");
  const missed = await currentLemma(page);
  await page.getByRole("button", { name: "I don't know" }).click();
  await expect(page.getByText("Not quite")).toBeVisible();
  await expect(page.getByText(rightAnswer(missed)).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  let cameBack = false;
  for (let i = 0; i < 12 && !cameBack; i++) {
    const card = page.locator(".question.card-enter");
    await expect(card.locator(".question__label")).toBeVisible();
    if ((await card.locator(".question__label").textContent()) === "Again") {
      expect(await currentLemma(page)).toBe(missed);
      cameBack = true;
      break;
    }
    await answerRight(page);
    await expect(page.locator(".feedback")).toBeVisible();
    await expect(page.locator(".feedback .badge")).toHaveText("Correct");
    await page.getByRole("button", { name: "Continue" }).click();
  }
  expect(cameBack).toBe(true);

  await page.goto("en/words");
  await page.getByRole("radio", { name: "Learning" }).click();
  await expect(page.getByText(missed, { exact: true })).toBeVisible();
});

test("settings: level per course, and French definitions in English", async ({ page, loggedIn }) => {
  void loggedIn;
  await page.goto("settings");
  const english = page.getByRole("radiogroup", { name: "Definitions" }).getByRole("radio", { name: "English" });
  await english.click();
  await expect(english).toHaveAttribute("aria-checked", "true");

  await page.goto("fr");
  await page.getByRole("radio", { name: /Intermediate/ }).click();
  await page.getByRole("button", { name: "Start from the most common words" }).click();
  const lemma = await currentLemma(page);
  await page.getByRole("button", { name: "I don't know" }).click();
  await expect(page.getByText(rightAnswer(lemma, "en")).first()).toBeVisible();

  await page.goto("settings");
  const levels = page.locator(".settings-course").nth(1).getByRole("radio", { name: /Intermediate/ });
  await expect(levels).toHaveAttribute("aria-checked", "true");
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
