import { defineConfig, devices } from "@playwright/test";

const configuredRetries = process.env.PLAYWRIGHT_RETRIES;
const retries = configuredRetries === undefined
  ? (process.env.CI ? 1 : 0)
  : Number(configuredRetries);

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/visual/**", "**/acceptance/**", "**/production/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries,
  failOnFlakyTests: !!process.env.CI,
  workers: process.env.CI ? Number(process.env.PLAYWRIGHT_WORKERS ?? 1) : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  expect: { timeout: 10_000 },
  // Keep one baseline per browser project so a local macOS run can validate
  // the same deterministic reference that the Linux CI runner consumes.
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}",
  projects: [
    {
      name: "chromium",
      testIgnore: ["**/visual/**", "**/acceptance/**", "**/production/**", "**/public-discovery.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined,
      },
    },
    {
      name: "mobile-chrome",
      testIgnore: ["**/visual/**", "**/acceptance/**", "**/production/**", "**/education-manual-fallback.spec.ts", "**/team-invitations.spec.ts", "**/major-entry.spec.ts", "**/public-match-live.spec.ts", "**/event-logo.spec.ts", "**/major-qualification.spec.ts", "**/series-score-correction.spec.ts", "**/session-revocation.spec.ts", "**/test-matches.spec.ts"],
      use: {
        ...devices["Pixel 5"],
        channel: process.env.PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined,
      },
    },
  ],
  webServer: {
    command: process.env.CI ? "pnpm dev:local > .agent-tmp/next-server.log 2>&1" : "pnpm dev:local",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
