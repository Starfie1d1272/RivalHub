import { defineConfig } from "vitest/config";
import integration from "./vitest.integration.config";

export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    name: "capacity-experiments",
    include: ["tests/experiments/**/*.test.ts"],
  },
});
