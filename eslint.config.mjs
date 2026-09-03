import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
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
      "no-restricted-globals": ["error", { name: "confirm", message: "Use InlineConfirm or AlertDialog instead." }],
      "no-restricted-properties": ["error", { object: "window", property: "confirm", message: "Use InlineConfirm or AlertDialog instead." }],
      "no-restricted-imports": ["error", {
        paths: [{
          name: "brackets-manager",
          message: "Use the canonical @/lib/bracket adapter; direct brackets-manager imports are only allowed under src/lib/bracket/.",
        }],
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
      // React 19.2's compiler diagnostics are advisory for this existing
      // client-component code; runtime behavior remains covered by unit/E2E.
      "react-hooks/incompatible-library": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "@next/next/no-css-tags": "off",
    },
  },
];

export default eslintConfig;
