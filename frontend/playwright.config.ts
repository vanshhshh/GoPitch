import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E against the local E2E stack:
 *  - API: backend/tests/e2e/server.ts on :4100 (real app, in-process Postgres, stubbed
 *    AI / Gmail / Razorpay — no real email, payment or AI call ever happens)
 *  - Web: Next.js dev server on :3100 pointed at that API
 * Tests share one database, so they run serially.
 */
const API = "http://localhost:4100";
const WEB = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    // Uses the full Chromium build Playwright already has installed (no headless-shell download).
    channel: "chromium",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1366, height: 900 } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel: "chromium", viewport: { width: 375, height: 812 } } },
  ],
  webServer: [
    {
      command: "npx tsx tests/e2e/server.ts",
      cwd: "../backend",
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npx next dev -p 3100",
      url: `${WEB}/login`,
      env: { NEXT_PUBLIC_API_BASE: API },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
