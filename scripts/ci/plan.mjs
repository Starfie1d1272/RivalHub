import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CAPABILITIES = ["static", "postgres", "system"];
const DB_BACKED_APP_PREFIXES = [
  "src/app/[seasonSlug]/",
  "src/app/admin/",
  "src/app/my/",
  "src/app/players/",
  "src/app/seasons/",
  "src/app/settings/",
  "src/app/team-invites/",
  "src/app/teams/",
];
const SYSTEM_APP_PREFIXES = [
  "src/app/auth/",
  "src/app/login/",
  "src/app/forgot-password/",
  "src/app/reset-password/",
  "src/app/my/",
  "src/app/[seasonSlug]/register/",
];
const SYSTEM_ACTION_PREFIXES = [
  "src/actions/auth",
  "src/actions/competition-entries.ts",
  "src/actions/major-prestart.ts",
  "src/actions/register.ts",
];

export function classifyChangedFiles(entries, options = {}) {
  const { forceFull = false } = options;
  if (forceFull) {
    return resultFor(CAPABILITIES, true, "受保护分支、merge queue、release 或手动运行，强制 full gate");
  }
  if (entries.length === 0) {
    return resultFor(CAPABILITIES, true, "无法取得 changed-surface，fail closed 到 full gate");
  }

  const capabilities = new Set();
  const reasons = new Set();
  let docsOnly = true;
  for (const entry of entries) {
    if (entry.status === "R" || entry.status === "D" || entry.status.startsWith("R") || entry.status.startsWith("D")) {
      return resultFor(CAPABILITIES, true, `检测到 ${entry.status} rename/delete：${entry.paths.join(" -> ")}`);
    }
    const classification = classifyPath(entry.paths[entry.paths.length - 1] ?? "");
    if (classification.capabilities === "full") {
      return resultFor(CAPABILITIES, true, classification.reason);
    }
    if (classification.capabilities.length > 0) docsOnly = false;
    for (const capability of classification.capabilities) capabilities.add(capability);
    reasons.add(classification.reason);
  }

  if (capabilities.size === 0) {
    return docsOnly
      ? resultFor([], false, "docs-only surface：只保留 planner + ci-gate")
      : resultFor(CAPABILITIES, true, "changed-surface 未命中已声明 capability，fail closed 到 full gate");
  }
  return resultFor([...capabilities].sort((a, b) => CAPABILITIES.indexOf(a) - CAPABILITIES.indexOf(b)), false, [...reasons].join("；"));
}

export function parseNameStatus(raw) {
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split("\t");
      const status = fields[0]?.trim() ?? "";
      return { status, paths: fields.slice(1).filter(Boolean) };
    });
}

function classifyPath(path) {
  const docs = path.startsWith("docs/") || path.endsWith(".md") || path.endsWith(".mdx");
  if (docs) return { capabilities: [], reason: `docs-only: ${path}` };

  const fullPrefixes = [
    ".github/",
    ".changeset/",
    "scripts/",
    "tests/integration/",
    "tests/e2e/",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "next.config.",
    "vitest.config.",
    "playwright.config.",
    "tsconfig",
    "eslint.config.",
    "postcss.config.",
    "drizzle.config.",
  ];
  if (fullPrefixes.some((prefix) => path === prefix || path.startsWith(prefix))) {
    return { capabilities: "full", reason: `toolchain/CI/harness surface: ${path}` };
  }

  if (path.startsWith("supabase/") && path !== "supabase/config.toml") {
    return { capabilities: "full", reason: `Supabase project surface: ${path}` };
  }
  if (path === "supabase/config.toml") {
    return { capabilities: ["system"], reason: `Supabase service contract: ${path}` };
  }

  if (path.startsWith("drizzle/migrations/")) {
    return { capabilities: ["postgres"], reason: `migration replay surface: ${path}` };
  }
  if (path.startsWith("drizzle/") || path.startsWith("src/db/")) {
    return { capabilities: ["static", "postgres"], reason: `database surface: ${path}` };
  }

  const source = readSourceDependencies(path);
  if (source.unreadable) {
    return { capabilities: "full", reason: `source dependency surface unreadable: ${path}` };
  }

  if (path.startsWith("src/actions/")) {
    const capabilities = ["static", "postgres"];
    if (
      SYSTEM_ACTION_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
      source.usesSupabase
    ) {
      capabilities.push("system");
    }
    return {
      capabilities,
      reason: `Server Action surface${source.usesSupabase ? " with Supabase dependency" : ""}: ${path}`,
    };
  }

  if (path.startsWith("src/app/")) {
    const capabilities = ["static"];
    if (DB_BACKED_APP_PREFIXES.some((prefix) => path.startsWith(prefix)) || source.usesDatabase) {
      capabilities.push("postgres");
    }
    if (SYSTEM_APP_PREFIXES.some((prefix) => path.startsWith(prefix)) || source.usesSupabase) {
      capabilities.push("system");
    }
    return { capabilities, reason: `App Router surface: ${path}` };
  }

  if (path.startsWith("src/components/")) {
    const capabilities = ["static"];
    if (source.usesDatabase) capabilities.push("postgres");
    if (source.usesSupabase) capabilities.push("system");
    return { capabilities, reason: `UI surface: ${path}` };
  }

  if (path.startsWith("tests/unit/")) {
    return { capabilities: ["static"], reason: `unit surface: ${path}` };
  }

  if (path.startsWith("src/lib/")) {
    const capabilities = ["static"];
    if (source.usesDatabase) capabilities.push("postgres");
    if (source.usesSupabase || path === "src/lib/auth/session.ts" || path.startsWith("src/lib/session/")) {
      capabilities.push("system");
    }
    return { capabilities, reason: `library surface: ${path}` };
  }
  if (path.startsWith("public/") || path.startsWith("styles/") || path.endsWith(".css")) {
    return { capabilities: ["static"], reason: `presentation asset surface: ${path}` };
  }
  return { capabilities: "full", reason: `unclassified surface: ${path}` };
}

function readSourceDependencies(path) {
  if (!path.startsWith("src/") || !/\.(?:[cm]?[jt]sx?)$/.test(path)) {
    return { usesDatabase: false, usesSupabase: false, unreadable: false };
  }

  try {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    return {
      usesDatabase: /(?:from\s+|import\s*\()\s*["']@\/db\/(?:client|schema)["']/.test(source),
      usesSupabase: /(?:from\s+|import\s*\()\s*["'](?:@\/lib\/auth\/supabase|@supabase\/supabase-js)["']/.test(source),
      unreadable: false,
    };
  } catch {
    return { usesDatabase: false, usesSupabase: false, unreadable: true };
  }
}

function resultFor(requiredJobs, full, reason) {
  return {
    full,
    requiredJobs,
    runStatic: requiredJobs.includes("static"),
    runPostgres: requiredJobs.includes("postgres"),
    runSystem: requiredJobs.includes("system"),
    reason,
  };
}

function output(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

function gitChangedFiles() {
  const base = process.env.BASE_SHA?.trim();
  const head = process.env.HEAD_SHA?.trim() || "HEAD";
  if (!base || /^0+$/.test(base)) return [];
  try {
    const raw = execFileSync("git", ["diff", "--name-status", "--find-renames=50%", `${base}...${head}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseNameStatus(raw);
  } catch (error) {
    console.error(`changed-surface git diff 失败：${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const forceFull = process.env.FORCE_FULL === "1" || process.env.FORCE_FULL === "true";
  const entries = gitChangedFiles();
  const plan = classifyChangedFiles(entries, { forceFull });
  console.log(`CI plan: ${plan.full ? "FULL" : plan.requiredJobs.join(" + ")} | ${plan.reason}`);
  for (const entry of entries) console.log(`changed ${entry.status}\t${entry.paths.join("\t")}`);
  output("full", String(plan.full));
  output("run_static", String(plan.runStatic));
  output("run_postgres", String(plan.runPostgres));
  output("run_system", String(plan.runSystem));
  output("required_jobs", JSON.stringify(plan.requiredJobs));
}
