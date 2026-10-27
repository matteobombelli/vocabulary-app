import { expect, test } from "./fixtures";

test("serves an installable manifest and a service worker that caches the app shell", async ({ page, loggedIn }) => {
  void loggedIn;
  const manifest = await page.request.get("manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    start_url: "/",
    scope: "/",
    display: "standalone",
  });

  await page.goto("");
  await expect(page.getByRole("heading", { name: "English", level: 1 })).toBeVisible();
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
  // Workbox keys non-hashed files with a revision query string.
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.length > 0 && (await (await caches.open(keys[0])).match("/index.html", { ignoreSearch: true })) !== undefined;
  });
  expect(cached).toBe(true);
});
