import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    settings: {
      react: {
        version: "19.2",
      },
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "public/**",
      ".local/**",
      "docs/archive/design-handoff/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-restricted-globals": ["error", { name: "confirm", message: "Use InlineConfirm or AlertDialog instead." }],
      "no-restricted-properties": ["error", { object: "window", property: "confirm", message: "Use InlineConfirm or AlertDialog instead." }],
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "brackets-manager",
            message: "Use the canonical @/lib/bracket adapter; direct brackets-manager imports are only allowed under src/lib/bracket/.",
          },
          {
            name: "@/db/client-runtime",
            message: "Use the canonical server-only @/db/client facade; the runtime implementation is reserved for Node CLI entrypoints.",
          },
          {
            name: "@/lib/observability/logger",
            message: "Use the server-only @/lib/observability/server facade.",
          },
          {
            name: "@/lib/observability/tracing",
            message: "Use the server-only @/lib/observability/server facade.",
          },
        ],
        patterns: [
          {
            group: ["**/db/client-runtime", "**/db/client-runtime.*"],
            message: "Use the canonical server-only @/db/client facade; relative runtime imports are reserved for the facade and Node CLI entrypoints.",
          },
        ],
      }],
    },
  },
  {
    // This client-only rendering fallback logs a fixed message without the error payload.
    files: ["src/components/matches/BracketView.tsx"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/db/client.ts"],
    rules: {
      // The facade is the one source import allowed to reach the Node runtime.
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "brackets-manager",
            message: "Use the canonical @/lib/bracket adapter; direct brackets-manager imports are only allowed under src/lib/bracket/.",
          },
        ],
      }],
    },
  },
  {
    files: ["src/lib/bracket/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    rules: {
      "@next/next/no-css-tags": "off",
    },
  },
];

export default eslintConfig;
