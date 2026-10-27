import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against `wrangler dev` with a throwaway D1 state loaded with fixture words
// (test/fixtures/words.ts), so they never touch .wrangler/state. The invite code and the stub
// grader are injected with --var, independent of .dev.vars.
const port = 8788;
const state = ".wrangler/e2e-state";
export const INVITE_CODE = "e2e-invite";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      `rm -rf ${state}`,
      `npx wrangler d1 migrations apply vocabulary-app --local --persist-to ${state}`,
      `node scripts/fixture-seed.ts 7500 > ${state}/seed.sql`,
      `npx wrangler d1 execute vocabulary-app --local --persist-to ${state} --file ${state}/seed.sql`,
      "npx vite build",
      `npx wrangler dev --port ${port} --persist-to ${state} --var REGISTRATION_SECRET:${INVITE_CODE} --var GRADER_MODE:stub --show-interactive-dev-session=false`,
    ].join(" && "),
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
