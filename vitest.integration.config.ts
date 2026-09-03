import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "integration-postgres",
    environment: "node",
    globals: true,
    include: ["tests/integration/db/**/*.test.ts"],
    pool: "forks",
    isolate: true,
    fileParallelism: true,
    maxWorkers: Number(process.env.RIVALHUB_INTEGRATION_WORKERS ?? 2),
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      tests: resolve(__dirname, "./tests"),
      "server-only": resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
});
