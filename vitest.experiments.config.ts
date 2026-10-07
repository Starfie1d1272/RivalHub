import { defineConfig, mergeConfig } from "vitest/config";
import integration from "./vitest.integration.config";

export default mergeConfig(integration, defineConfig({
  test: { name: "capacity-experiments", include: ["tests/experiments/**/*.test.ts"] },
}));
