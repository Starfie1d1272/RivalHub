import { defineConfig } from "@playwright/test";
import core from "./playwright.config";

export default defineConfig({
  ...core,
  testDir: "./tests/e2e/production",
  testIgnore: [],
  projects: core.projects?.map(project => ({ ...project, testIgnore: [] })),
  webServer: {
    command: "pnpm build:local && pnpm exec next start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
