import { INVITE_CODE } from "../playwright.config";
import { PASSWORD, expect, registerViaApi, test, uniqueEmail } from "./fixtures";

test("register through the form, log out, log back in", async ({ page }) => {
  const email = uniqueEmail("form");
  await page.goto("register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Invite code").fill(INVITE_CODE);
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByRole("heading", { name: "English", level: 1 })).toBeVisible();

  await page.goto("settings");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "English", level: 1 })).toBeVisible();
});

test("redirects to login when signed out, and back to the deep link after", async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const email = await registerViaApi(ctx.request);
  await ctx.close();

  await page.goto("fr/words");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/fr\/words$/);
});
