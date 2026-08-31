import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "public/**",
      ".local/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", { name: "confirm", message: "Use InlineConfirm or AlertDialog instead." }],
      "no-restricted-properties": ["error", { object: "window", property: "confirm", message: "Use InlineConfirm or AlertDialog instead." }],
    },
  },
];

export default eslintConfig;
