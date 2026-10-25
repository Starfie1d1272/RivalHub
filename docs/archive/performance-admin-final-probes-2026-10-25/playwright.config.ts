import { defineConfig, devices } from "@playwright/test";
import base from "../../../playwright.config";

export default defineConfig(base, {
  testDir: "../../../tests/e2e/acceptance",
  testMatch: "admin-final-bounded-probes.spec.ts",
  testIgnore: [],
  workers: 1,
  retries: 0,
  projects: [{ name: "chromium", testIgnore: [], use: devices["Desktop Chrome"] }],
  webServer: { ...base.webServer, reuseExistingServer: false },
});
