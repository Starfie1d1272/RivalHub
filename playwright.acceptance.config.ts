import { defineConfig } from "@playwright/test";
import core from "./playwright.config";

export default defineConfig({ ...core, testMatch: ["**/visual/*.spec.ts", "**/acceptance/*.spec.ts"], testIgnore: [], projects: core.projects?.map(project => ({ ...project, testIgnore: [] })) });
