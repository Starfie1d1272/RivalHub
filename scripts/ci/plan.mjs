import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CAPABILITIES = ["static", "postgres", "system"];

const STATIC_PROJECTS = ["unit-domain-node", "unit-server-node", "unit-react-jsdom"];
const FULL_STATIC_MATRIX = [
  { task: "type-app", changedPaths: [] },
  { task: "type-tests", changedPaths: [] },
  { task: "type-scripts", changedPaths: [] },
  { task: "lint", changedPaths: [] },
  ...STATIC_PROJECTS.map((project) => ({ task: taskNameForProject(project), project, mode: "full", changedPaths: [] })),
  { task: "dead-code", changedPaths: [] },
  { task: "build", changedPaths: [] },
];

const GLOBAL_CONTRACTS = {
  e2e: { project: "unit-domain-node", path: "tests/unit/quality/e2e-contract.test.ts" },
  architecture: { project: "unit-domain-node", path: "tests/unit/quality/architecture-boundaries.test.ts" },
};

const DB_BACKED_APP_PREFIXES = [
  "src/app/[seasonSlug]/",
  "src/app/admin/",
  "src/app/my/",
  "src/app/team-invites/",
  "src/app/teams/",
  "src/app/players/",
  "src/app/seasons/",
  "src/app/settings/",
];
const SYSTEM_APP_PREFIXES = [
  "src/app/auth/",
  "src/app/login/",
  "src/app/forgot-password/",
  "src/app/reset-password/",
  "src/app/my/",
  "src/app/team-invites/",
  "src/app/teams/",
  "src/app/[seasonSlug]/register/",
  "src/app/api/test/e2e/",
];
const SYSTEM_ACTION_PREFIXES = [
  "src/actions/auth",
  "src/actions/competition-entries.ts",
  "src/actions/major-prestart.ts",
  "src/actions/register.ts",
];

const SYSTEM_FLOW_MAP = [
  { prefixes: ["src/app/auth/", "src/app/login/", "src/actions/auth", "src/lib/auth/", "src/lib/session/"], specs: ["tests/e2e/flows/major-entry.spec.ts"] },
  { prefixes: ["src/app/settings/education", "src/actions/education", "src/lib/education/"], specs: ["tests/e2e/flows/education-manual-fallback.spec.ts"] },
  { prefixes: ["src/app/team-invites/", "src/app/teams/", "src/actions/team"], specs: ["tests/e2e/flows/team-invitations.spec.ts"] },
  { prefixes: ["src/app/[seasonSlug]/register/", "src/actions/competition-entries.ts", "src/actions/register.ts", "src/actions/major-prestart.ts"], specs: ["tests/e2e/flows/major-entry.spec.ts"] },
  { prefixes: ["src/app/teams/", "src/app/players/"], specs: ["tests/e2e/flows/public-discovery.spec.ts"] },
];

const CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
const LINT_EXTENSIONS = /\.[cm]?[jt]sx?$/;
const E2E_SPEC_FILE = /^tests\/e2e\/.+\.spec\.(?:[cm]?[jt]sx?)$/;
const INTEGRATION_SPEC_FILE = /^tests\/integration\/db\/(?!harness\/).+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;

export function classifyChangedFiles(entries, options = {}) {
  const { forceFull = false, draft = true } = options;
  const gateName = draft ? "draft-gate" : "ci-gate";
  const result = (...args) => ({ ...resultFor(...args), gateName });
  if (forceFull || !draft) {
    return result(CAPABILITIES, true, forceFull
      ? "受保护分支、merge queue、release 或手动运行，强制 full gate"
      : "Ready for review PR 使用 FULL evidence gate");
  }
  if (entries.length === 0) {
    return result(CAPABILITIES, true, "无法取得 changed-surface，fail closed 到 full gate");
  }

  const capabilities = new Set();
  const reasons = new Set();
  const evidence = {
    typeApp: false,
    typeTests: false,
    typeScripts: false,
    lintPaths: new Set(),
    unitRelatedSources: new Map(STATIC_PROJECTS.map((project) => [project, new Set()])),
    unitExplicitTests: new Map(STATIC_PROJECTS.map((project) => [project, new Set()])),
    integrationSpecs: new Set(),
    e2eSpecs: new Set(),
  };
  let docsOnly = true;
  for (const entry of entries) {
    if (entry.status === "R" || entry.status === "D" || entry.status.startsWith("R") || entry.status.startsWith("D")) {
      return resultFor(CAPABILITIES, true, `检测到 ${entry.status} rename/delete：${entry.paths.join(" -> ")}`);
    }
    const path = entry.paths[entry.paths.length - 1] ?? "";
    const classification = classifyPath(path);
    if (classification.capabilities === "full") {
      return result(CAPABILITIES, true, classification.reason);
    }
    if (classification.capabilities.length > 0) docsOnly = false;
    for (const capability of classification.capabilities) capabilities.add(capability);
    reasons.add(classification.reason);
    collectEvidence(path, classification, evidence);
  }

  if (capabilities.size === 0) {
    return docsOnly
      ? result([], false, "docs-only surface：只保留 planner + draft-gate")
      : result(CAPABILITIES, true, "changed-surface 未命中已声明 capability，fail closed 到 full gate");
  }

  const staticMatrix = buildStaticMatrix(evidence);
  return result(
    [...capabilities].sort((a, b) => CAPABILITIES.indexOf(a) - CAPABILITIES.indexOf(b)),
    false,
    [...reasons].join("；"),
    {
      staticMatrix,
      unitMode: staticMatrix.some((item) => item.mode === "related" || item.mode === "explicit") ? "affected" : "none",
      relatedSources: unique([...evidence.unitRelatedSources.values()].flatMap((paths) => [...paths])),
      explicitTests: unique([...evidence.unitExplicitTests.values()].flatMap((paths) => [...paths])),
      integrationSpecs: [...evidence.integrationSpecs].sort(),
      e2eSpecs: [...evidence.e2eSpecs].sort(),
    },
  );
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
  if (path.startsWith(".changeset/")) {
    return { capabilities: [], reason: `release metadata: ${path}` };
  }

  const docs = path.startsWith("docs/") || path.endsWith(".md") || path.endsWith(".mdx");
  if (docs) return { capabilities: [], reason: `docs-only: ${path}` };

  const fullPrefixes = [
    ".github/",
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

  if (path.startsWith("tests/integration/db/harness/") || path === "tests/integration/setup.ts") {
    return { capabilities: "full", reason: `integration harness surface: ${path}` };
  }
  if (path.startsWith("tests/integration/db/")) {
    return isIntegrationSpec(path)
      ? { capabilities: ["static", "postgres"], reason: `real PostgreSQL integration spec: ${path}`, integrationSpecs: [path] }
      : { capabilities: ["static", "postgres"], reason: `integration support surface；PostgreSQL 使用 full suite: ${path}` };
  }
  if (path.startsWith("tests/e2e/")) {
    return isE2ESpec(path)
      ? { capabilities: ["static", "system"], reason: `browser and Local Supabase E2E spec: ${path}`, e2eSpecs: [path] }
      : { capabilities: ["static", "system"], reason: `E2E support surface；system 使用 full suite: ${path}` };
  }

  const source = readSourceDependencies(path);
  if (source.unreadable) {
    return { capabilities: "full", reason: `source dependency surface unreadable: ${path}` };
  }

  if (path.startsWith("scripts/")) return classifyScriptPath(path);

  if (path.startsWith("src/actions/")) {
    const capabilities = ["static", "postgres"];
    if (SYSTEM_ACTION_PREFIXES.some((prefix) => path.startsWith(prefix)) || source.usesSupabase) {
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

function classifyScriptPath(path) {
  if (path.startsWith("scripts/ci/timing") || path.startsWith("scripts/ci/vitest-timing-reporter")) {
    return { capabilities: ["static"], reason: `CI timing utility surface: ${path}` };
  }
  if (path.startsWith("scripts/ci/system-artifact")) {
    return { capabilities: ["static", "system"], reason: `system artifact security surface: ${path}` };
  }
  if (path.startsWith("scripts/db/major-browser-fixture") || path.startsWith("scripts/db/local")) {
    return { capabilities: ["static", "postgres", "system"], reason: `database/browser fixture surface: ${path}` };
  }
  if (path.startsWith("scripts/db/integration") || path.startsWith("scripts/db/pg17") || path.startsWith("scripts/db/prepare-pg17")) {
    return { capabilities: ["static", "postgres"], reason: `PostgreSQL harness surface: ${path}` };
  }
  if (path.startsWith("scripts/db/")) {
    return { capabilities: ["static", "postgres"], reason: `database utility surface: ${path}` };
  }
  if (path.startsWith("scripts/release/") || path.startsWith("scripts/vercel-build")) {
    return { capabilities: ["static"], reason: `release utility surface: ${path}` };
  }
  return { capabilities: "full", reason: `unclassified script surface: ${path}` };
}

function collectEvidence(path, classification, evidence) {
  const isCode = CODE_EXTENSIONS.test(path);
  const isTest = path.startsWith("tests/");
  const isScript = path.startsWith("scripts/");
  evidence.typeApp ||= path.startsWith("src/");
  evidence.typeTests ||= isTest;
  evidence.typeScripts ||= isScript;
  if (isCode || LINT_EXTENSIONS.test(path)) evidence.lintPaths.add(path);

  if (classification.integrationSpecs) {
    for (const spec of classification.integrationSpecs) evidence.integrationSpecs.add(spec);
  }
  if (classification.e2eSpecs) {
    for (const spec of classification.e2eSpecs) evidence.e2eSpecs.add(spec);
  }
  if (path.startsWith("tests/e2e/")) evidence.unitExplicitTests.get("unit-domain-node").add(GLOBAL_CONTRACTS.e2e.path);

  const project = unitProjectFor(path);
  if (project && isTest) evidence.unitExplicitTests.get(project).add(path);
  if (project && isCode && !isTest) evidence.unitRelatedSources.get(project).add(path);
  if (path.startsWith("src/")) evidence.unitExplicitTests.get("unit-domain-node").add(GLOBAL_CONTRACTS.architecture.path);

  for (const mapping of SYSTEM_FLOW_MAP) {
    if (mapping.prefixes.some((prefix) => path.startsWith(prefix))) {
      for (const spec of mapping.specs) evidence.e2eSpecs.add(spec);
    }
  }
}

function unitProjectFor(path) {
  if (
    path.startsWith("src/app/")
    || path.startsWith("src/actions/")
    || path.startsWith("src/db/")
    || /^(tests\/unit\/(actions|api|app|db|release)\/)/.test(path)
  ) return "unit-server-node";
  if (path.endsWith(".tsx") || path.startsWith("src/components/")) return "unit-react-jsdom";
  if (path.startsWith("src/") || path.startsWith("tests/unit/")) return "unit-domain-node";
  return undefined;
}

function taskNameForProject(project) {
  return project === "unit-domain-node" ? "unit-domain"
    : project === "unit-server-node" ? "unit-server"
      : "unit-react";
}

function buildStaticMatrix(evidence) {
  const matrix = [];
  if (evidence.typeApp) matrix.push({ task: "type-app", changedPaths: [] });
  if (evidence.typeTests) matrix.push({ task: "type-tests", changedPaths: [] });
  if (evidence.typeScripts) matrix.push({ task: "type-scripts", changedPaths: [] });

  const lintPaths = [...evidence.lintPaths].filter((path) => LINT_EXTENSIONS.test(path)).sort();
  if (lintPaths.length > 0) matrix.push({ task: "lint-changed", changedPaths: lintPaths });

  for (const project of STATIC_PROJECTS) {
    const relatedSources = [...evidence.unitRelatedSources.get(project)].sort();
    if (relatedSources.length > 0) {
      matrix.push({ task: `unit-related-${project}`, project, mode: "related", relatedSources });
    }
    const explicitTests = [...evidence.unitExplicitTests.get(project)].sort();
    if (explicitTests.length > 0) {
      matrix.push({ task: `unit-explicit-${project}`, project, mode: "explicit", explicitTests });
    }
  }

  if (matrix.length === 0) matrix.push({ task: "type-app", changedPaths: [] });
  return matrix;
}

function readSourceDependencies(path) {
  if (!path.startsWith("src/") || !/\.(?:[cm]?[jt]sx?)$/.test(path)) {
    return { usesDatabase: false, usesSupabase: false, unreadable: false };
  }

  try {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    return {
      usesDatabase: /(?:from\s+|import\s*\()\s*["']@\/db\/(?:client|schema)["']/.test(source),
      usesSupabase: /(?:from\s+|import\s*\()\s*["'](?:@\/lib\/auth\/supabase(?:-server)?|@supabase\/supabase-js)["']/.test(source),
      unreadable: false,
    };
  } catch {
    return { usesDatabase: false, usesSupabase: false, unreadable: true };
  }
}

function resultFor(requiredJobs, full, reason, evidence = {}) {
  const staticMatrix = full ? FULL_STATIC_MATRIX : evidence.staticMatrix ?? [];
  return {
    full,
    requiredJobs,
    runStatic: staticMatrix.length > 0,
    runPostgres: requiredJobs.includes("postgres"),
    runSystem: requiredJobs.includes("system"),
    staticMatrix,
    unitMode: full ? "full" : evidence.unitMode ?? "none",
    relatedSources: full ? [] : evidence.relatedSources ?? [],
    explicitTests: full ? [] : evidence.explicitTests ?? [],
    integrationSpecs: full ? [] : evidence.integrationSpecs ?? [],
    e2eSpecs: full ? [] : evidence.e2eSpecs ?? [],
    reason,
  };
}

function isE2ESpec(path) {
  return E2E_SPEC_FILE.test(path);
}

function isIntegrationSpec(path) {
  return INTEGRATION_SPEC_FILE.test(path);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function output(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${name}=${value}\n`);
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
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const forceFull = process.env.FORCE_FULL === "1" || process.env.FORCE_FULL === "true" || eventName !== "pull_request";
  const draft = process.env.PR_DRAFT !== "false";
  const entries = gitChangedFiles();
  const plan = classifyChangedFiles(entries, { forceFull, draft });
  console.log(`CI plan: ${plan.full ? "FULL" : plan.requiredJobs.join(" + ")} | ${plan.reason}`);
  for (const entry of entries) console.log(`changed ${entry.status}\t${entry.paths.join("\t")}`);
  output("full", String(plan.full));
  output("run_static", String(plan.runStatic));
  output("run_postgres", String(plan.runPostgres));
  output("run_system", String(plan.runSystem));
  output("required_jobs", JSON.stringify(plan.requiredJobs));
  output("static_matrix", JSON.stringify(plan.staticMatrix));
  output("unit_mode", plan.unitMode);
  output("related_sources", JSON.stringify(plan.relatedSources));
  output("explicit_tests", JSON.stringify(plan.explicitTests));
  output("postgres_mode", plan.integrationSpecs.length > 0 ? "affected" : "full");
  output("integration_specs", JSON.stringify(plan.integrationSpecs));
  output("system_mode", plan.e2eSpecs.length > 0 ? "affected" : "full");
  output("e2e_specs", JSON.stringify(plan.e2eSpecs));
  output("gate_name", plan.gateName);
}
