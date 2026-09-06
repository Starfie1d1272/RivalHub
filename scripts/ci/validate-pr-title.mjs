import { pathToFileURL } from "node:url";

const ALLOWED_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "release",
  "revert",
];

const PR_TITLE_PATTERN = new RegExp(
  `^(${ALLOWED_TYPES.join("|")})(?:\\([^()\\s]+\\))?:\\s+\\S.*$`,
);

export function isValidPrTitle(title) {
  return typeof title === "string" && PR_TITLE_PATTERN.test(title);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const title = process.env.PR_TITLE ?? "";
  if (!isValidPrTitle(title)) {
    console.error("PR title must match type(scope): summary with an allowed type and non-empty summary.");
    process.exit(1);
  }
  console.log(`Valid PR title: ${title}`);
}
