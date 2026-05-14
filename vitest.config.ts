import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/integration/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**"],
      exclude: ["src/app/**", "src/components/ui/**"],
      thresholds: {
        lines: 30,
        functions: 60,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      tests: resolve(__dirname, "./tests"),
    },
  },
});
