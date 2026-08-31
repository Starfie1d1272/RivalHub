import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/integration/db/**/*.test.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      tests: resolve(__dirname, "./tests"),
    },
  },
});
