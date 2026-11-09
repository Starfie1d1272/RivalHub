import { defineConfig, devices } from "@playwright/test";

const excluded = ["**/visual/**", "**/acceptance/**", "**/production/**"];
const touchFlows = ["**/bet.spec.ts", "**/free-predictions.spec.ts", "**/predictions.spec.ts"];

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: excluded,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 0),
  failOnFlakyTests: !!process.env.CI,
  workers: process.env.CI ? Number(process.env.PLAYWRIGHT_WORKERS ?? 1) : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  expect: { timeout: 10_000 },
  // Keep one baseline per browser project so a local macOS run can validate
  // the same deterministic reference that the Linux CI runner consumes.
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}",
  projects: [
    {
      name: "chromium",
      // Shared flows run once, on the viewport exercising their distinct risk:
      // touch submission/download on mobile.
      testIgnore: [...excluded, ...touchFlows],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined,
      },
    },
    {
      name: "mobile-chrome",
      testMatch: touchFlows,
      use: {
        ...devices["Pixel 5"],
        channel: process.env.PLAYWRIGHT_CHANNEL === "chrome" ? "chrome" : undefined,
      },
    },
  ],
  webServer: {
    command: process.env.CI ? "pnpm dev:local > .agent-tmp/next-server.log 2>&1" : "pnpm dev:local",
    // Process readiness only; do not compile an unrelated homepage.
    url: "http://localhost:3000/favicon.ico",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
