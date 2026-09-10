import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { ExpectedMigration } from "../production-preflight";
import type { RecoveryMigrationIdentity, RecoverySourceIdentity } from "./manifest";
import { assertReleaseIdentity } from "../../../src/lib/release/identity";

const projectRoot = resolve(process.cwd());
const DEFAULT_PRODUCTION_BASE_URL = "https://match.starfie1d.top";
const RELEASE_ENDPOINT_PATH = "/api/system/release";
const RELEASE_READBACK_TIMEOUT_MS = 10_000;

export type ProductionReleaseFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function resolveProductionSourceIdentity(
  cwd = projectRoot,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: ProductionReleaseFetcher = fetch,
): Promise<Omit<RecoverySourceIdentity, "databaseMigrationTerminal">> {
  const endpoint = buildReleaseEndpoint(env.RIVALHUB_PRODUCTION_BASE_URL);
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(RELEASE_READBACK_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`canonical production release identity read-back failed: ${reason}`);
  }

  if (!response.ok) {
    throw new Error(`canonical production release identity returned HTTP ${response.status}; backup aborted.`);
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("canonical production release identity response is not valid JSON; backup aborted.");
  }

  const identity = assertReleaseIdentity(value, "canonical production release identity");
  const taggedCommit = resolveGitRevision(cwd, `refs/tags/${identity.releaseTag}^{commit}`);
  if (taggedCommit.toLowerCase() !== identity.releaseCommit.toLowerCase()) {
    throw new Error("canonical production release identity tag 与 commit 不匹配；backup aborted.");
  }
  return { deployedReleaseTag: identity.releaseTag, deployedCommit: identity.releaseCommit };
}

export function buildRecoveryMigrationPlan(
  expected: readonly ExpectedMigration[],
  terminal: RecoveryMigrationIdentity,
): ExpectedMigration[] {
  const terminalIndex = expected.findIndex(
    (entry) => entry.tag === terminal.terminalTag
      && entry.hash === terminal.terminalHash
      && entry.when === terminal.terminalWhen,
  );
  if (terminalIndex < 0) {
    throw new Error("Recovery snapshot migration terminal is not present in the active repository chain; restore aborted. ");
  }
  return expected.slice(0, terminalIndex + 1);
}

function resolveGitRevision(cwd: string, ref: string): string {
  const result = spawnSync("git", ["rev-parse", ref], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const commit = result.stdout.trim();
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("production source tag 无法解析为 commit；backup aborted。 ");
  }
  return commit;
}

function buildReleaseEndpoint(baseUrl: string | undefined): string {
  if (baseUrl !== undefined && !baseUrl.trim()) {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 不能是空值；backup aborted。");
  }

  const configured = baseUrl?.trim() ?? DEFAULT_PRODUCTION_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是有效的 HTTPS origin；backup aborted。");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是无凭据、无路径的 HTTPS origin；backup aborted。");
  }
  return `${parsed.origin}${RELEASE_ENDPOINT_PATH}`;
}
