import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSchedulerPath, isStorageMutationPath } from "../ci/plan.mjs";
import { classifyMigrationRisk, type MigrationRiskLevel } from "../db/migration-risk";

export type ReleasePlanMigrationRisk = MigrationRiskLevel;

export interface ReleaseChangeEntry {
  status: string;
  paths: string[];
}

export interface ReleasePlan {
  releaseSha: string;
  previousReleaseCommit: string;
  changedPaths: string[];
  applicationChanged: boolean;
  migrationChanged: boolean;
  migrationRisk: ReleasePlanMigrationRisk;
  storageMutationChanged: boolean;
  schedulerChanged: boolean;
  recoveryInfraChanged: boolean;
  releaseInfraChanged: boolean;
  requiresMigrationRehearsal: boolean;
  requiresProductionMigration: boolean;
  requiresDbCheckpoint: boolean;
  requiresFullCheckpoint: boolean;
  requiresSchedulerProvision: boolean;
}

export interface BuildReleasePlanOptions {
  cwd?: string;
  releaseSha?: string;
  previousReleaseCommit?: string;
  entries?: readonly ReleaseChangeEntry[];
  migrationContents?: Readonly<Record<string, string | undefined>>;
}

const METADATA_PATHS = new Set(["CHANGELOG.md", "package.json"]);
const SOURCE_ROOTS = ["src/", "public/", "styles/"];
export function buildReleasePlan(options: BuildReleasePlanOptions = {}): ReleasePlan {
  const cwd = options.cwd ?? process.cwd();
  const releaseSha = resolveCommit(
    cwd,
    options.releaseSha ?? process.env.RIVALHUB_RELEASE_SHA ?? process.env.RELEASE_SHA ?? "HEAD",
    "candidate release commit",
  );
  const previousReleaseCommit = resolveCommit(
    cwd,
    options.previousReleaseCommit ?? process.env.RIVALHUB_PREVIOUS_RELEASE_COMMIT ?? "",
    "previous Production commit",
  );
  if (releaseSha.toLowerCase() === previousReleaseCommit.toLowerCase()) {
    throw new Error("previous Production commit 与 candidate 相同；release plan 拒绝继续。");
  }
  if (!isAncestor(cwd, previousReleaseCommit, releaseSha)) {
    throw new Error("previous Production commit 不在 candidate 的 main 提交链上；release plan 拒绝猜测 baseline。");
  }

  const entries = options.entries ?? readChangedEntries(cwd, previousReleaseCommit, releaseSha);
  const changedPaths = unique(entries.flatMap((entry) => entry.paths));
  const migrationPaths = unique(changedPaths.filter((path) => path.startsWith("drizzle/migrations/")));
  const migrationChanged = migrationPaths.length > 0;
  const migrationRisk = migrationChanged
    ? resolveMigrationRisk(cwd, releaseSha, entries, migrationPaths, options.migrationContents)
    : "none";
  const storageMutationChanged = changedPaths.some(isStorageMutationPath);
  const schedulerChanged = changedPaths.some(isSchedulerPath)
    || (changedPaths.includes("package.json")
      && !isPackageVersionOnlyChange(options, cwd, releaseSha, previousReleaseCommit, entries))
    || migrationPaths.some((path) => {
      const text = migrationText(cwd, releaseSha, path, options.migrationContents);
      return text === undefined || Boolean(text.match(/\b(?:scheduler|cron)\b/i));
    });
  const recoveryInfraChanged = changedPaths.some((path) =>
    path.startsWith("scripts/db/recovery/") || path.startsWith(".github/workflows/recovery-"),
  );
  const releaseInfraChanged = changedPaths.some((path) =>
    path.startsWith("scripts/release/")
    || path === "scripts/vercel-build.ts"
    || path === "vercel.json"
    || path === ".github/workflows/release.yml",
  );

  return {
    releaseSha,
    previousReleaseCommit,
    changedPaths,
    applicationChanged: changedPaths.some((path) => isApplicationPath(path, options, cwd, releaseSha, previousReleaseCommit, entries)),
    migrationChanged,
    migrationRisk,
    storageMutationChanged,
    schedulerChanged,
    recoveryInfraChanged,
    releaseInfraChanged,
    requiresMigrationRehearsal: migrationChanged,
    requiresProductionMigration: migrationChanged,
    requiresDbCheckpoint: migrationRisk === "irreversible",
    requiresFullCheckpoint: storageMutationChanged,
    requiresSchedulerProvision: schedulerChanged,
  };
}

function resolveMigrationRisk(
  cwd: string,
  releaseSha: string,
  entries: readonly ReleaseChangeEntry[],
  migrationPaths: readonly string[],
  migrationContents: Readonly<Record<string, string | undefined>> | undefined,
): ReleasePlanMigrationRisk {
  let sawForwardCompatibleStatement = false;
  let sawSqlMigration = false;
  for (const path of migrationPaths) {
    const entry = entries.find((candidate) => candidate.paths.includes(path));
    if (entry?.status.startsWith("D") || entry?.status.startsWith("R")) return "irreversible";
    if (!path.endsWith(".sql")) continue;
    sawSqlMigration = true;
    const sql = migrationText(cwd, releaseSha, path, migrationContents);
    if (sql === undefined) return "irreversible";
    const summary = classifyMigrationRisk(sql, path);
    if (summary.risk === "irreversible") return "irreversible";
    sawForwardCompatibleStatement ||= summary.risk === "forward-compatible";
  }
  return sawSqlMigration && sawForwardCompatibleStatement ? "forward-compatible" : "irreversible";
}

function migrationText(
  cwd: string,
  releaseSha: string,
  path: string,
  migrationContents: Readonly<Record<string, string | undefined>> | undefined,
): string | undefined {
  if (migrationContents && Object.prototype.hasOwnProperty.call(migrationContents, path)) {
    return migrationContents[path];
  }
  try {
    return readGitFile(cwd, releaseSha, path);
  } catch {
    return undefined;
  }
}

function isApplicationPath(
  path: string,
  options: BuildReleasePlanOptions,
  cwd: string,
  releaseSha: string,
  previousReleaseCommit: string,
  entries: readonly ReleaseChangeEntry[],
): boolean {
  if (path.startsWith("drizzle/migrations/") || path.startsWith("scripts/db/recovery/")) return false;
  if (path.startsWith("scripts/release/") || path === "scripts/vercel-build.ts") return false;
  if (path.startsWith(".github/workflows/recovery-") || path === ".github/workflows/release.yml") return false;
  if (path.startsWith("docs/") || path.endsWith(".md") || path.endsWith(".mdx") || path.startsWith(".changeset/")) return false;
  if (METADATA_PATHS.has(path)) {
    return !isPackageVersionOnlyChange(options, cwd, releaseSha, previousReleaseCommit, entries);
  }
  if (path.startsWith("scripts/db/")) return false;
  if (path.startsWith("scripts/ci/")) return false;
  return SOURCE_ROOTS.some((root) => path.startsWith(root))
    || path === "vercel.json"
    || path.startsWith("package.")
    || path.startsWith("pnpm-")
    || path.startsWith("next.config.")
    || path.startsWith("supabase/")
    || (!path.startsWith(".github/") && !path.startsWith("drizzle/"));
}

function isPackageVersionOnlyChange(
  options: BuildReleasePlanOptions,
  cwd: string,
  releaseSha: string,
  previousReleaseCommit: string,
  entries: readonly ReleaseChangeEntry[],
): boolean {
  if (!entries.some((entry) => entry.paths.includes("package.json"))) return false;
  let before: string;
  let after: string;
  try {
    before = readGitFile(cwd, previousReleaseCommit, "package.json");
    after = readGitFile(cwd, releaseSha, "package.json");
  } catch {
    return false;
  }
  if (!before || !after) return false;
  try {
    const beforeJson = JSON.parse(before) as Record<string, unknown>;
    const afterJson = JSON.parse(after) as Record<string, unknown>;
    if (beforeJson.version === afterJson.version || typeof beforeJson.version !== "string" || typeof afterJson.version !== "string") return false;
    delete beforeJson.version;
    delete afterJson.version;
    return JSON.stringify(sortJson(beforeJson)) === JSON.stringify(sortJson(afterJson));
  } catch {
    return false;
  }
}

function readChangedEntries(cwd: string, previousReleaseCommit: string, releaseSha: string): ReleaseChangeEntry[] {
  const raw = execFileSync("git", ["diff", "--name-status", "--find-renames=50%", `${previousReleaseCommit}...${releaseSha}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return raw.split("\n").filter(Boolean).map((line) => {
    const fields = line.split("\t");
    return { status: fields[0] ?? "", paths: fields.slice(1).filter(Boolean) };
  });
}

function readGitFile(cwd: string, revision: string, path: string): string {
  return execFileSync("git", ["show", `${revision}:${path}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveCommit(cwd: string, revision: string, label: string): string {
  if (!revision.trim()) throw new Error(`${label} 未设置；release plan 拒绝继续。`);
  try {
    const commit = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("not a commit");
    return commit;
  } catch {
    throw new Error(`${label} 无法解析为 Git commit：${revision}`);
  }
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJson(entry)]));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function output(name: string, value: string | boolean | readonly string[]): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const serialized = Array.isArray(value) ? JSON.stringify(value) : String(value);
  appendFileSync(outputPath, `${name}=${serialized}\n`);
}

function cliMain(): void {
  const plan = buildReleasePlan();
  console.log(JSON.stringify(plan, null, 2));
  for (const [key, value] of Object.entries(plan)) output(key, value);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    cliMain();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
