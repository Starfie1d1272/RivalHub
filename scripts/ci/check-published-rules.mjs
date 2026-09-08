import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function checkPublishedRules(base, head, cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  // Resolve commits first: a missing baseline must never silently unlock rules.
  for (const ref of [base, head]) git("rev-parse", "--verify", `${ref}^{commit}`);
  const changed = git("diff", "--name-status", "--no-renames", base, head, "--", "docs/rules/published/")
    .trim().split("\n").filter(Boolean);
  const forbidden = changed.filter((line) => !line.startsWith("A\t"));
  if (forbidden.length) throw new Error(`Published rules are immutable. Add a supplement or a new version:\n${forbidden.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE_SHA || "HEAD^";
  const head = process.env.HEAD_SHA || "HEAD";
  checkPublishedRules(base, head);
}
