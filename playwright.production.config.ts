import { defineConfig } from "@playwright/test";
import core from "./playwright.config";

export default defineConfig({
  ...core,
  testDir: "./tests/e2e/production",
  testIgnore: [],
  projects: core.projects?.map(project => ({ ...project, testIgnore: [] })),
  webServer: {
    command: "node tests/e2e/helpers/production-server.mjs",
    url: "http://localhost:3000/favicon.ico",
    stdout: "pipe",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
