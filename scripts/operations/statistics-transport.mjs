import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIRST_COMPATIBLE_COMMIT = "46ef46ad1677a73c0b6ed685ed8a7e4d18dfba81";
const ENDPOINT = "https://match.starfie1d.top/api/system/release";
const SHA = /^[a-f0-9]{40}$/i;
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export function validateCursor(cursor) {
  if (cursor === "") return "";
  if (typeof cursor !== "string" || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid cursor");
  const bytes = Buffer.from(cursor, "base64url");
  if (bytes.toString("base64url") !== cursor) throw new Error("Invalid cursor");
  let parsed;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error("Invalid cursor"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "completedAt,importId" ||
    typeof parsed.completedAt !== "string" || !DATE.test(parsed.completedAt) || Number.isNaN(Date.parse(parsed.completedAt)) ||
    typeof parsed.importId !== "string" || !UUID.test(parsed.importId)) throw new Error("Invalid cursor");
  const [year, month, day] = parsed.completedAt.slice(0, 10).split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error("Invalid cursor");
  return cursor;
}

export function validateInputs({ mode, limit, cursor = "" }) {
  if (mode !== "dry" && mode !== "apply") throw new Error("Invalid mode");
  if (typeof limit !== "string" || !/^[1-9]\d{0,2}$/.test(limit)) throw new Error("Invalid limit");
  const count = Number(limit);
  if (count > (mode === "apply" ? 150 : 500)) throw new Error("Limit exceeds mode maximum");
  return { mode, limit: count, cursor: validateCursor(cursor) };
}

export function validateIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "releaseCommit,releaseTag" ||
    typeof value.releaseTag !== "string" || !TAG.test(value.releaseTag) || typeof value.releaseCommit !== "string" || !SHA.test(value.releaseCommit)) throw new Error("Invalid production identity");
  return { releaseTag: value.releaseTag, releaseCommit: value.releaseCommit.toLowerCase() };
}

export async function readIdentity(fetcher = fetch) {
  const response = await fetcher(ENDPOINT, { headers: { accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Production identity unavailable");
  return validateIdentity(await response.json());
}

function git(args, cwd = process.cwd()) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function checkIdentity(identity, operatorSha, runGit = git) {
  identity = validateIdentity(identity);
  if (!SHA.test(operatorSha)) throw new Error("Invalid operator SHA");
  if (runGit(["rev-parse", `refs/tags/${identity.releaseTag}^{commit}`]) !== identity.releaseCommit) throw new Error("Production tag mismatch");
  runGit(["merge-base", "--is-ancestor", FIRST_COMPATIBLE_COMMIT, identity.releaseCommit]);
  runGit(["merge-base", "--is-ancestor", identity.releaseCommit, operatorSha]);
  const pkg = JSON.parse(runGit(["show", `${identity.releaseCommit}:package.json`]));
  if (`v${pkg.version}` !== identity.releaseTag) throw new Error("Production package version mismatch");
}

export function commandArgs(input) {
  return ["exec", "tsx", "scripts/db/production-stats-projections.ts", "transport-backfill",
    ...(input.mode === "apply" ? ["--apply"] : []), "--limit", String(input.limit), ...(input.cursor ? ["--cursor", input.cursor] : [])];
}

export function executionEnvironment(env, mode) {
  const result = { ...env, RIVALHUB_DB_TARGET: "production", RIVALHUB_PRODUCTION_PROJECT_CONFIRM: "atjiukerfgqlwvnctigc",
    RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: "aws-0-ap-northeast-1.pooler.supabase.com:6543" };
  delete result.RIVALHUB_ALLOW_REMOTE_DB_WRITE;
  delete result.RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM;
  delete result.GITHUB_TOKEN;
  if (mode === "apply") {
    result.RIVALHUB_ALLOW_REMOTE_DB_WRITE = "production";
    result.RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM = "I_UNDERSTAND_STATS_PROJECTION_WRITE";
  }
  return result;
}

export function parseReport(output, input) {
  const start = output.lastIndexOf("\n{");
  let report;
  try { report = JSON.parse(start < 0 ? output : output.slice(start + 1)); } catch { throw new Error("Backfill report unavailable"); }
  const counts = ["scanned", "encoded", "already", "legacy_retained", "not_current", "invalid", "originalBytes", "encodedBytes"];
  if (!report || typeof report !== "object" || report.target !== "production" || report.mode !== (input.mode === "apply" ? "apply" : "dry-run") ||
    counts.some(key => !Number.isSafeInteger(report[key]) || report[key] < 0) || typeof report.complete !== "boolean" ||
    !(report.nextCursor === null || typeof report.nextCursor === "string")) throw new Error("Invalid backfill report");
  if (report.scanned > input.limit || (report.nextCursor === "") || (report.complete && report.nextCursor !== null)) throw new Error("Invalid backfill report");
  const nextCursor = report.nextCursor === null ? null : validateCursor(report.nextCursor);
  return { mode: input.mode, limit: input.limit, ...Object.fromEntries(counts.map(key => [key, report[key]])),
    complete: report.complete, inputCursor: input.cursor || null, nextCursor, resumeCursor: report.complete ? null : (nextCursor || input.cursor || null) };
}

export async function runBatch({ input, expected, operatorSha, worktree, env, fetcher = fetch, spawn = spawnSync, runGit = git }) {
  const current = await readIdentity(fetcher);
  if (current.releaseTag !== expected.releaseTag || current.releaseCommit !== expected.releaseCommit) throw new Error("Production identity changed");
  if (runGit(["rev-parse", "HEAD"], worktree) !== expected.releaseCommit) throw new Error("Deployed worktree mismatch");
  if (!env.DATABASE_URL || env.DATABASE_URL === "[SENSITIVE]") throw new Error("Production database unavailable");
  const child = spawn("pnpm", commandArgs(input), { cwd: worktree, env: executionEnvironment(env, input.mode), encoding: "utf8", maxBuffer: 1024 * 1024 });
  let report;
  try { report = parseReport(child.stdout ?? "", input); } catch { throw new Error("Backfill failed without a valid report"); }
  const summary = { operatorSha, productionTag: expected.releaseTag, productionSha: expected.releaseCommit, ...report };
  if (child.error || child.status !== 0 || report.invalid > 0) return { summary, failed: true };
  return { summary, failed: false };
}

async function main() {
  const input = validateInputs({ mode: process.env.INPUT_MODE, limit: process.env.INPUT_LIMIT, cursor: process.env.INPUT_CURSOR ?? "" });
  const operatorSha = process.env.GITHUB_SHA ?? "";
  const worktree = resolve(process.env.RUNNER_TEMP ?? "", "statistics-transport-production");
  if (process.argv[2] === "identify") {
    const identity = await readIdentity();
    appendFileSync(process.env.GITHUB_OUTPUT, `release_tag=${identity.releaseTag}\n`);
  } else if (process.argv[2] === "prepare") {
    const identity = await readIdentity();
    checkIdentity(identity, operatorSha);
    git(["worktree", "add", "--detach", worktree, identity.releaseCommit]);
    appendFileSync(process.env.GITHUB_OUTPUT, `release_tag=${identity.releaseTag}\nrelease_sha=${identity.releaseCommit}\n`);
    console.log(JSON.stringify({ operatorSha, productionTag: identity.releaseTag, productionSha: identity.releaseCommit, mode: input.mode, limit: input.limit }));
  } else if (process.argv[2] === "run") {
    const expected = validateIdentity({ releaseTag: process.env.FROZEN_RELEASE_TAG, releaseCommit: process.env.FROZEN_RELEASE_SHA });
    const { summary, failed } = await runBatch({ input, expected, operatorSha, worktree, env: process.env });
    console.log(JSON.stringify(summary));
    if (failed) process.exitCode = 1;
  } else throw new Error("Invalid operation");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Statistics transport operation failed; no untrusted output was emitted."); process.exitCode = 1; });
}
