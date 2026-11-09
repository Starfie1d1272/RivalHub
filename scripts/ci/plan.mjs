import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { postgresSpecCount, postgresSpecsForSource } from "./postgres-selection.mjs";

export const CAPABILITIES = ["static", "postgres", "system"];

const STATIC_PROJECTS = ["unit-domain-node", "unit-server-node", "unit-react-jsdom"];
const FULL_STATIC_MATRIX = [
  { task: "checks", changedPaths: [] },
  { task: "unit-all", mode: "full", changedPaths: [] },
  { task: "build", changedPaths: [] },
];

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
// Mizar/RivalHub machine contract surfaces. These need the cross-repo adapter and
// parser evidence from scripts/mizar-contract-check.mjs, not business-table REST.
const LIVE_SURFACES = [
  "src/actions/season-public-info.ts",
  "src/lib/season-public-info/",
  "src/lib/mizar/",
  "src/components/matches/MatchLiveProvider",
  "src/components/matches/MatchRealtime",
  "src/components/matches/MatchListLiveScore",
  "src/components/matches/MatchRadar",
  "src/lib/integrations/pairing-security.ts",
  "src/db/schema/mizar.ts",
  "src/app/api/mizar/",
  "src/app/api/matches/",
  "src/app/integrations/mizar/",
  "scripts/db/mizar-live-fixture",
  "scripts/mizar-contract-check.mjs",
  "tests/fixtures/contracts/",
  "drizzle/migrations/0066_mizar_backend_contracts",
];
const SYSTEM_FLOW_MAP = [
  { prefixes: ["src/lib/admin/season-context.ts", "src/app/admin/layout.tsx", "src/app/admin/logs/"], specs: ["tests/e2e/flows/admin-immediate-boundaries.spec.ts"] },
  { prefixes: ["src/lib/registrations/admin-review", "src/app/admin/[seasonSlug]/registrations/"], specs: ["tests/e2e/flows/admin-season-private-reads.spec.ts"] },

  { prefixes: ["src/actions/test-matches.ts", "src/lib/matches/test-matches.ts", "src/components/matches/TestMatch", "src/app/admin/[seasonSlug]/test-matches/"], specs: ["tests/e2e/flows/test-matches.spec.ts"] },
  { prefixes: ["src/actions/bet.ts", "src/components/bet/BetBoard", "src/components/bet/BetOperations"], specs: ["tests/e2e/flows/bet.spec.ts"] },
  { prefixes: ["src/actions/free-predictions.ts", "src/components/bet/FreePrediction"], specs: ["tests/e2e/flows/free-predictions.spec.ts"] },
  { prefixes: ["src/actions/identity.ts", "src/lib/identity/linking.ts", "src/components/auth/SecondaryIdentityConfirmationForm.tsx"], specs: ["tests/e2e/flows/secondary-email-confirmation.spec.ts"] },
  { prefixes: ["src/actions/predictions.ts", "src/components/predictions/PickEm", "src/components/predictions/PredictionBoard.tsx", "src/components/predictions/PickEditor.tsx"], specs: ["tests/e2e/flows/predictions.spec.ts"] },
  { prefixes: ["src/actions/competition-qualification.ts", "src/components/admin/MajorPrestartConsole", "src/components/admin/MajorCompetitionFlow.tsx"], specs: ["tests/e2e/flows/major-qualification.spec.ts"] },
  { prefixes: ["src/components/matches/SeriesScoreCorrection"], specs: ["tests/e2e/flows/series-score-correction.spec.ts"] },
  { prefixes: ["src/components/teams/TeamInvitationsSection"], specs: ["tests/e2e/flows/team-invitations.spec.ts"] },
  {
    // LIVE keeps its provider evidence without a permanent browser flow.
    prefixes: ["src/lib/mizar/", "src/components/matches/MatchLiveProvider", "src/components/matches/MatchRealtime", "src/components/matches/MatchListLiveScore", "src/components/matches/MatchRadar", "src/app/api/matches/"],
    specs: [],
  },
  {
    prefixes: ["src/actions/season-public-info.ts", "src/lib/season-public-info/", "src/components/admin/SeasonLogoEditor.tsx", "src/components/season/EventLogo.tsx"],
    specs: ["tests/e2e/flows/event-logo.spec.ts"],
  },
  {
    prefixes: [
      "src/app/auth/",
      "src/app/login/",
      "src/app/forgot-password/",
      "src/app/reset-password/",
      "src/actions/auth",
      "src/actions/account.ts",
      "src/actions/password-recovery.ts",
      "src/actions/session-management.ts",
      "src/lib/auth/",
      "src/lib/session/",
      "src/app/api/test/e2e/",
      "src/components/auth/LoginForm.tsx",
      "src/components/auth/TurnstileWidget.tsx",
    ],
    specs: ["tests/e2e/flows/major-entry.spec.ts", "tests/e2e/flows/session-revocation.spec.ts", "tests/e2e/flows/secondary-email-confirmation.spec.ts"],
  },
];

const BROWSER_GROUPS = {
  account: ["account-transport-budget", "major-entry", "secondary-email-confirmation", "session-revocation"],
  admin: ["admin-awards-boundaries", "admin-content-read-boundaries", "admin-season-private-reads"],
  // The Flight query-count probe reads database-wide pg_stat_statements.
  "admin-query": ["admin-immediate-boundaries"],
  predictions: ["bet", "free-predictions", "predictions"],
  matches: ["mizar-source-lifecycle", "ocr-receipt-recovery", "series-score-correction"],
  events: ["event-logo", "major-qualification"],
  teams: ["team-invitations", "test-matches"],
};

const PRODUCTION_HARNESS_PREFIXES = [
  "playwright.production.config.",
  "tests/e2e/production/",
  "tests/e2e/helpers/production-server",
  "tests/e2e/helpers/bet-read-stages.ts",
];

const PRODUCTION_SMOKE_PREFIXES = [
  ...PRODUCTION_HARNESS_PREFIXES,
  "tests/e2e/fixtures.ts",
  "tests/e2e/helpers/production-server",
  "tests/e2e/helpers/bet-read-stages.ts",
  "scripts/db/local.ts",
  "scripts/db/local-environment.ts",
  "src/app/layout.tsx",
  "src/components/layout/Header",
  "src/components/layout/SeasonNav.tsx",
  "src/app/login/",
  "src/lib/auth/session.ts",
  "src/lib/session/",
  "src/app/api/bet/",
  "src/app/[seasonSlug]/bet/",
  "src/lib/bet/board-read.ts",
  "src/lib/bet/read-access.ts",
  "src/lib/bet/request-read.ts",
];

function isDeploymentTool(path) {
  return path.startsWith("scripts/standby/") || path === "scripts/release/linux-routing.ts"
    || path === ".github/workflows/release.yml" || path === ".github/workflows/standby-package.yml";
}

function browserSpecs(directory = "tests/e2e") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? (["visual", "acceptance", "production"].includes(entry.name) ? [] : browserSpecs(path)) : /\.spec\.tsx?$/.test(path) ? [path] : [];
  }).sort();
}

function systemSpecsForPath(path) {
  const specs = new Set();
  for (const mapping of SYSTEM_FLOW_MAP) {
    if (mapping.prefixes.some((prefix) => path === prefix || path.startsWith(prefix))) {
      for (const spec of mapping.specs) specs.add(spec);
    }
  }
  return [...specs];
}

const CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
const LINT_EXTENSIONS = /\.[cm]?[jt]sx?$/;
const E2E_SPEC_FILE = /^tests\/e2e\/.+\.spec\.(?:[cm]?[jt]sx?)$/;
const INTEGRATION_SPEC_FILE = /^tests\/integration\/db\/(?!harness\/).+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
export function classifyChangedFiles(entries, options = {}) {
  const { forceFull = false, draft = true } = options;
  const gateName = draft ? "draft-gate" : "ci-gate";
  const liveSurfaceChanged = entries.some((entry) =>
    (entry.paths ?? []).some((path) => LIVE_SURFACES.some((prefix) => path === prefix || path.startsWith(prefix))),
  );
  const result = (...args) => {
    const plan = resultFor(...args);
    const liveEvidence = plan.full || liveSurfaceChanged;
    return { ...plan, gateName, liveEvidence,
      systemMatrix: systemMatrixFor(plan, liveEvidence),
      // Empty selection runs the complete suite. Affected sets approaching the
      // full suite need the same bounded parallelism without dropping filters.
      postgresMatrix: plan.runPostgres
        ? (plan.integrationSpecs.length === 0 || plan.integrationSpecs.length * 4 >= postgresSpecCount() * 3
          ? [{ shard: "1/2" }, { shard: "2/2" }] : [{ shard: "1/1" }])
        : [],
    };
  };
  if (forceFull) {
    return result(CAPABILITIES, true, "merge queue、手动运行或缺少基准提交，强制 full gate");
  }
  if (entries.length === 0) {
    return result(CAPABILITIES, true, "无法取得 changed-surface，fail closed 到 full gate");
  }

  if (isReleaseMetadataOnly(entries, options)) {
    return result([], false, "release-metadata-only：只包含 version、CHANGELOG 与 Changeset metadata");
  }

  const capabilities = new Set();
  const reasons = new Set();
  const evidence = {
    typeApp: false,
    typeTests: false,
    typeScripts: false,
    architecture: false,
    lintPaths: new Set(),
    unitRelatedSources: new Set(),
    unitExplicitTests: new Map(STATIC_PROJECTS.map((project) => [project, new Set()])),
    integrationSpecs: new Set(),
    integrationFull: false,
    e2eFull: false,
    e2eSpecs: new Set(),
    provider: false,
    production: false,
    deployment: false,
  };
  for (const entry of entries) {
    const removed = /^[DR]/.test(entry.status);
    for (const [index, path] of entry.paths.entries()) {
      const existsAtHead = !removed || index > 0;
      const classification = classifyPath(path, existsAtHead);
      if (classification.capabilities === "full") {
        return result(CAPABILITIES, true, classification.reason);
      }

      for (const capability of classification.capabilities) capabilities.add(capability);
      reasons.add(classification.reason);
      evidence.provider ||= classification.provider === true;
      evidence.production ||= PRODUCTION_SMOKE_PREFIXES.some(prefix => path.startsWith(prefix));
      evidence.deployment ||= isDeploymentTool(path);
      evidence.e2eFull ||= classification.e2eFull === true;
      if (!existsAtHead) {
        evidence.typeTests ||= path.startsWith("tests/");
        continue;
      }
      collectEvidence(path, classification, evidence);
      if (classification.capabilities.includes("postgres") && !classification.integrationSpecs) {
        const specs = postgresSpecsForSource(path);
        if (specs === null) evidence.integrationFull = true;
        else for (const spec of specs) evidence.integrationSpecs.add(spec);
      }
    }
  }

  if (evidence.e2eSpecs.size || evidence.e2eFull || liveSurfaceChanged || evidence.provider || evidence.production) {
    capabilities.add("system");
  }

  if (capabilities.size === 0) {
    return result([], false, `docs-only surface：只保留 planner + ${gateName}`);
  }

  const staticMatrix = capabilities.has("static") ? buildStaticMatrix(evidence) : [];
  return result(
    [...capabilities].sort((a, b) => CAPABILITIES.indexOf(a) - CAPABILITIES.indexOf(b)),
    false,
    [...reasons].join("；"),
    {
      staticMatrix,
      integrationSpecs: evidence.integrationFull ? [] : [...evidence.integrationSpecs].sort(),
      e2eSpecs: evidence.e2eFull ? browserSpecs() : [...evidence.e2eSpecs].sort(),
      provider: evidence.provider,
      production: evidence.production,
    },
  );
}

/**
 * A package.json change is safe to keep on the metadata-only fast path only
 * when the semantic JSON is unchanged apart from its top-level version.
 * Callers that do not provide both snapshots fail closed to the normal FULL
 * package/toolchain classification.
 */
export function isReleaseMetadataOnly(entries, options = {}) {
  const changedPaths = entries.flatMap((entry) => entry.paths ?? []);
  const packageEntries = entries.filter((entry) => entry.paths?.includes("package.json"));
  if (packageEntries.length !== 1 || packageEntries[0].status !== "M") return false;
  if (changedPaths.some((path) => !isReleaseMetadataPath(path))) return false;

  const before = options.packageJsonBefore;
  const after = options.packageJsonAfter;
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return false;
  if (before.version === after.version || typeof before.version !== "string" || typeof after.version !== "string") {
    return false;
  }

  return stableSemanticJson(withoutPackageVersion(before)) === stableSemanticJson(withoutPackageVersion(after));
}

function isReleaseMetadataPath(path) {
  return isChangesetNote(path) || path === "CHANGELOG.md" || path === "package.json";
}

function withoutPackageVersion(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "version"));
}

function stableSemanticJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(stableSemanticJsonValue));
  return JSON.stringify(stableSemanticJsonValue(value));
}

function stableSemanticJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableSemanticJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableSemanticJsonValue(entry)]),
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

function isChangesetNote(path) {
  return /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path);
}

function classifyPath(path, existsAtHead) {
  if (isChangesetNote(path)) return { capabilities: [], reason: `release metadata: ${path}` };

  const docs = path === ".impeccable/design.json" || path.startsWith("docs/") || path.endsWith(".md") || path.endsWith(".mdx");
  if (docs) return { capabilities: [], reason: `docs-only: ${path}` };

  if (!existsAtHead && (isIntegrationSpec(path) || isE2ESpec(path) || /^tests\/unit\/.*\.test\.[cm]?[jt]sx?$/.test(path))) {
    return { capabilities: ["static"], reason: `removed test; check remaining consumers: ${path}` };
  }
  if (!existsAtHead && path.startsWith("src/") && CODE_EXTENSIONS.test(path)) {
    return { capabilities: "full", reason: `removed executable surface: ${path}` };
  }

  if (PRODUCTION_HARNESS_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return { capabilities: ["static"], reason: `production browser smoke surface: ${path}` };
  }
  if (isDeploymentTool(path)) {
    return { capabilities: ["static"], reason: `deployment owner: ${path}` };
  }

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
    return { capabilities: ["system"], provider: true, reason: `Supabase service contract: ${path}` };
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
  if (path.startsWith("tests/e2e/acceptance/") || path.startsWith("tests/e2e/visual/")) {
    return { capabilities: ["static"], reason: `opt-in visual/acceptance surface: ${path}` };
  }
  if (path.startsWith("tests/e2e/")) {
    return isE2ESpec(path)
      ? { capabilities: ["static"], reason: `browser and Local Supabase E2E spec: ${path}`, e2eSpecs: [path] }
      : { capabilities: ["static"], e2eFull: true, reason: `shared E2E support: ${path}` };
  }

  const source = existsAtHead ? readSourceDependencies(path) : { usesDatabase: false, usesSupabase: false };
  if (source.unreadable) {
    return { capabilities: "full", reason: `source dependency surface unreadable: ${path}` };
  }

  if (path.startsWith("scripts/")) return classifyScriptPath(path);

  if (path.startsWith("src/actions/")) {
    const capabilities = ["static", "postgres"];
    return {
      capabilities,
      provider: source.usesSupabase,
      reason: `Server Action surface${source.usesSupabase ? " with Supabase dependency" : ""}: ${path}`,
    };
  }

  if (path.startsWith("src/app/")) {
    const capabilities = ["static"];
    if (DB_BACKED_APP_PREFIXES.some((prefix) => path.startsWith(prefix)) || source.usesDatabase) {
      capabilities.push("postgres");
    }
    return { capabilities, provider: source.usesSupabase, reason: `App Router surface: ${path}` };
  }

  if (path.startsWith("src/components/")) {
    const capabilities = ["static"];
    if (source.usesDatabase) capabilities.push("postgres");
    return { capabilities, provider: source.usesSupabase, reason: `UI surface: ${path}` };
  }

  if (path.startsWith("tests/unit/")) {
    return { capabilities: ["static"], reason: `unit surface: ${path}` };
  }

  if (path.startsWith("src/lib/")) {
    const capabilities = ["static"];
    if (source.usesDatabase) capabilities.push("postgres");
    return { capabilities, provider: source.usesSupabase, reason: `library surface: ${path}` };
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
    return { capabilities: ["static"], reason: `system artifact security surface: ${path}` };
  }
  if (path.startsWith("scripts/mizar-contract-check")) {
    return { capabilities: ["static"], reason: `Mizar cross-repo contract surface: ${path}` };
  }
  if (path.startsWith("scripts/db/major-browser-fixture") || path.startsWith("scripts/db/local")) {
    return { capabilities: ["static", "postgres"], e2eFull: true, provider: path.startsWith("scripts/db/local"), reason: `database/browser fixture surface: ${path}` };
  }
  if (/^scripts\/db\/(?:verification-contract|verify-supabase)/.test(path)) {
    return { capabilities: ["static"], provider: true, reason: `provider verification surface: ${path}` };
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
  const isTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
  const isTestSupport = path.startsWith("tests/");
  const isScript = path.startsWith("scripts/");
  evidence.typeApp ||= path.startsWith("src/");
  evidence.typeTests ||= isTest || isTestSupport;
  evidence.typeScripts ||= isScript;
  evidence.architecture ||= path.startsWith("src/") || path.startsWith("scripts/architecture/");
  if (isCode || LINT_EXTENSIONS.test(path)) evidence.lintPaths.add(path);

  if (classification.integrationSpecs) {
    for (const spec of classification.integrationSpecs) evidence.integrationSpecs.add(spec);
  }
  if (classification.e2eSpecs) {
    for (const spec of classification.e2eSpecs) evidence.e2eSpecs.add(spec);
  }

  const project = unitProjectFor(path);
  if (project && isTest) evidence.unitExplicitTests.get(project).add(path);
  if (isCode && !isTest) {
    // Consumers can belong to any project, regardless of the source folder.
    evidence.unitRelatedSources.add(path);
  }
  for (const spec of systemSpecsForPath(path)) {
    evidence.e2eSpecs.add(spec);
  }
}

function unitProjectFor(path) {
  if (path.endsWith(".tsx")) return "unit-react-jsdom";
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

function buildStaticMatrix(evidence) {
  const matrix = [];
  if (evidence.typeApp) matrix.push({ task: "format" }, { task: "type-app" });
  if (evidence.typeTests) matrix.push({ task: "type-tests", changedPaths: [] });
  if (evidence.typeScripts) matrix.push({ task: "type-scripts", changedPaths: [] });
  if (evidence.architecture) matrix.push({ task: "architecture", changedPaths: [] });

  const lintPaths = [...evidence.lintPaths].filter((path) => LINT_EXTENSIONS.test(path)).sort();
  if (lintPaths.length > 0) matrix.push({ task: "lint-changed", changedPaths: lintPaths });

  if (evidence.unitRelatedSources.size) {
    matrix.push({ task: "unit-related", relatedSources: [...evidence.unitRelatedSources].sort() });
  }
  for (const project of STATIC_PROJECTS) {
    const explicitTests = [...evidence.unitExplicitTests.get(project)].sort();
    if (explicitTests.length > 0) {
      matrix.push({ task: `unit-explicit-${project}`, project, explicitTests });
    }
  }

  if (evidence.deployment) matrix.push({ task: "deployment" });
  if (matrix.length === 0) matrix.push({ task: "type-app" });
  return [{ task: "affected", checks: matrix }];
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
    integrationSpecs: full ? [] : evidence.integrationSpecs ?? [],
    e2eSpecs: full ? [] : evidence.e2eSpecs ?? [],
    provider: full || evidence.provider === true,
    production: full || evidence.production === true,
    reason,
  };
}

// Use a fixed set of browser groups so adding a spec does not add a Supabase
// environment. Unassigned specs still run in the mixed group.
export function systemMatrixFor(plan, liveEvidence) {
  if (!plan.runSystem) return [];
  const specs = new Set(plan.full ? browserSpecs() : plan.e2eSpecs);
  const matrix = [];
  if (plan.provider || liveEvidence) matrix.push({ task: "provider", live: liveEvidence, profile: "full" });
  if (plan.production) matrix.push({ task: "production", live: false, profile: "auth" });

  for (const [group, names] of Object.entries(BROWSER_GROUPS)) {
    const selected = names.map(name => `tests/e2e/flows/${name}.spec.ts`).filter(spec => specs.delete(spec));
    if (selected.length) {
      const needsStorage = selected.includes("tests/e2e/flows/event-logo.spec.ts");
      matrix.push({ task: `browser-${group}`, specs: selected, live: false, profile: needsStorage ? "full" : "auth" });
    }
  }
  if (specs.size) matrix.push({ task: "browser-mixed", specs: [...specs].sort(), live: false, profile: "full" });
  return matrix;
}

function isE2ESpec(path) {
  return E2E_SPEC_FILE.test(path);
}

function isIntegrationSpec(path) {
  return INTEGRATION_SPEC_FILE.test(path);
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
  const forceFull = process.env.FORCE_FULL === "1" || process.env.FORCE_FULL === "true";
  const draft = process.env.PR_DRAFT !== "false";
  const entries = gitChangedFiles();
  const plan = classifyChangedFiles(entries, {
    forceFull,
    draft,
    packageJsonBefore: readPackageJsonAtRevision(process.env.BASE_SHA),
    packageJsonAfter: readPackageJsonAtRevision(process.env.HEAD_SHA || "HEAD"),
  });
  console.log(`CI plan: ${plan.full ? "FULL" : plan.requiredJobs.join(" + ")} | ${plan.reason}`);
  for (const entry of entries) console.log(`changed ${entry.status}\t${entry.paths.join("\t")}`);
  output("run_static", String(plan.runStatic));
  output("run_postgres", String(plan.runPostgres));
  output("run_system", String(plan.runSystem));
  output("required_jobs", JSON.stringify(plan.requiredJobs));
  output("static_matrix", JSON.stringify(plan.staticMatrix));
  output("system_matrix", JSON.stringify(plan.systemMatrix));
  output("postgres_matrix", JSON.stringify(plan.postgresMatrix));
  output("integration_specs", JSON.stringify(plan.integrationSpecs));
  output("gate_name", plan.gateName);

}

function readPackageJsonAtRevision(revision) {
  if (!revision || /^0+$/.test(revision)) return undefined;
  try {
    return JSON.parse(execFileSync("git", ["show", `${revision}:package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch {
    return undefined;
  }
}
