import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      tests: resolve(__dirname, "./tests"),
      "server-only": resolve(__dirname, "./tests/mocks/server-only.ts"),
    },
  },
  test: {
    globals: true,
    pool: "forks",
    isolate: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**"],
      exclude: ["src/app/**", "src/components/ui/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit-domain-node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.mjs", "src/**/*.test.ts"],
          exclude: [
            "tests/unit/actions/**",
            "tests/unit/api/**",
            "tests/unit/app/**",
            "tests/unit/db/**",
            "tests/unit/release/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "unit-server-node",
          environment: "node",
          include: [
            "tests/unit/actions/**/*.test.ts",
            "tests/unit/api/**/*.test.ts",
            "tests/unit/app/**/*.test.ts",
            "tests/unit/db/**/*.test.ts",
            "tests/unit/release/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "unit-react-jsdom",
          environment: "jsdom",
          setupFiles: ["./tests/setup-dom.ts"],
          include: ["tests/unit/**/*.test.tsx", "src/**/*.test.tsx"],
        },
      },
    ],
  },
});
