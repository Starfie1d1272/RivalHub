import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { assertReleaseIdentity, type ReleaseIdentity } from "../../src/lib/release/identity";

export const PREVIOUS_RELEASE_TAG_ENV = "RIVALHUB_PREVIOUS_RELEASE_TAG";
export const PREVIOUS_RELEASE_COMMIT_ENV = "RIVALHUB_PREVIOUS_RELEASE_COMMIT";
export const REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV = "RIVALHUB_REQUIRE_EXPLICIT_PREVIOUS_RELEASE";
export const RELEASE_MODE_ENV = "RIVALHUB_RELEASE_MODE";
export const RETRY_PREVIOUS_RELEASE_TAG_ENV = "RIVALHUB_RETRY_PREVIOUS_RELEASE_TAG";
export const RETRY_PREVIOUS_RELEASE_COMMIT_ENV = "RIVALHUB_RETRY_PREVIOUS_RELEASE_COMMIT";

const DEFAULT_PRODUCTION_BASE_URL = "https://match.starfie1d.top";
const RELEASE_ENDPOINT_PATH = "/api/system/release";
const RELEASE_READBACK_TIMEOUT_MS = 10_000;
const SHIPPED_SOURCE_ROOTS = ["src", "scripts"] as const;

export type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;
export type ProductionReleaseFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Resolve the single explicit previous-Production identity supplied to release consumers.
 * Returning null is only for developer/CI callers that intentionally opt into Git-derived
 * compatibility helpers; the Production release path must require this pair.
 */
export function resolveConfiguredPreviousProductionIdentity(
  cwd = process.cwd(),
  env: ReleaseEnvironment = process.env,
  candidateHead = env.RIVALHUB_MIGRATION_HEAD_SHA?.trim() || "HEAD",
): ReleaseIdentity | null {
  const tag = env[PREVIOUS_RELEASE_TAG_ENV];
  const commit = env[PREVIOUS_RELEASE_COMMIT_ENV];
  if (tag === undefined && commit === undefined) return null;
  if (tag === undefined || commit === undefined) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} 与 ${PREVIOUS_RELEASE_COMMIT_ENV} 必须同时提供；拒绝使用不完整的 previous Production identity。`);
  }

  let identity: ReleaseIdentity;
  try {
    identity = assertReleaseIdentity({ releaseTag: tag.trim(), releaseCommit: commit.trim() }, "previous Production identity");
  } catch (error) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV}/${PREVIOUS_RELEASE_COMMIT_ENV} 无效：${error instanceof Error ? error.message : String(error)}`);
  }

  const taggedCommit = resolveGitRevision(cwd, `refs/tags/${identity.releaseTag}`, `${PREVIOUS_RELEASE_TAG_ENV} tag`);
  if (taggedCommit.toLowerCase() !== identity.releaseCommit) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} 与 ${PREVIOUS_RELEASE_COMMIT_ENV} 不匹配：tag 指向 ${taggedCommit}，配置为 ${identity.releaseCommit}。`);
  }

  const candidateCommit = resolveGitRevision(cwd, candidateHead, "candidate commit");
  if (candidateCommit.toLowerCase() === identity.releaseCommit) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} ${identity.releaseTag} 与候选版本相同；previous Production identity 必须早于 candidate。`);
  }
  if (!isAncestor(cwd, identity.releaseCommit, candidateCommit)) {
    throw new Error(`previous Production commit ${identity.releaseCommit} 不在 candidate ${candidateCommit} 的 main 提交链上；拒绝猜测 release baseline。`);
  }

  const shippedSource = listShippedSources(cwd, identity.releaseCommit);
  if (shippedSource.length === 0) {
    throw new Error(`previous Production commit ${identity.releaseCommit} 不包含 shipped source；拒绝将其作为 release baseline。`);
  }

  return identity;
}

/** Freeze the authoritative previous-Production identity before any release mutation. */
export async function freezeCanonicalProductionIdentity(options: {
  cwd?: string;
  env?: ReleaseEnvironment;
  fetcher?: ProductionReleaseFetcher;
  candidateHead?: string;
} = {}): Promise<ReleaseIdentity> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const candidateHead = options.candidateHead ?? env.RIVALHUB_MIGRATION_HEAD_SHA?.trim() ?? "HEAD";
  const candidateCommit = resolveGitRevision(cwd, candidateHead, "candidate commit").toLowerCase();
  const releaseTag = env.RELEASE_TAG?.trim() ?? "";
  const candidateIdentity = assertReleaseIdentity({ releaseTag, releaseCommit: candidateCommit }, "candidate release identity");
  const candidateTaggedCommit = resolveGitRevision(cwd, `refs/tags/${candidateIdentity.releaseTag}`, "candidate release tag").toLowerCase();
  if (candidateTaggedCommit !== candidateIdentity.releaseCommit) {
    throw new Error(`candidate release tag ${candidateIdentity.releaseTag} 未指向 candidate commit ${candidateIdentity.releaseCommit}；release 已中止。`);
  }

  const canonicalIdentity = await readCanonicalProductionIdentity(env, options.fetcher ?? fetch);
  const retryTag = env[RETRY_PREVIOUS_RELEASE_TAG_ENV]?.trim() ?? "";
  const retryCommit = env[RETRY_PREVIOUS_RELEASE_COMMIT_ENV]?.trim() ?? "";
  const hasRetryBaseline = Boolean(retryTag || retryCommit);

  let frozenIdentity: ReleaseIdentity;
  let releaseMode: "fresh" | "resume";

  if (sameReleaseIdentity(canonicalIdentity, candidateIdentity)) {
    if (!retryTag || !retryCommit) {
      throw new Error(
        `candidate ${candidateIdentity.releaseTag} 已经是 canonical Production；安全重试必须同时提供 ` +
        `${RETRY_PREVIOUS_RELEASE_TAG_ENV} 与 ${RETRY_PREVIOUS_RELEASE_COMMIT_ENV}，使用首次 release run 冻结的 previous Production pair。`,
      );
    }
    const retryIdentity = resolveConfiguredPreviousProductionIdentity(cwd, {
      ...env,
      [PREVIOUS_RELEASE_TAG_ENV]: retryTag,
      [PREVIOUS_RELEASE_COMMIT_ENV]: retryCommit,
    }, candidateHead);
    if (!retryIdentity) throw new Error("resume release baseline 解析失败；release 已中止。");
    frozenIdentity = retryIdentity;
    releaseMode = "resume";
  } else {
    if (hasRetryBaseline) {
      throw new Error(
        `${RETRY_PREVIOUS_RELEASE_TAG_ENV}/${RETRY_PREVIOUS_RELEASE_COMMIT_ENV} 仅用于 candidate 已经成为 canonical Production 后的 same-tag resume；当前必须使用 canonical Production 作为 baseline。`,
      );
    }
    const canonicalPrevious = resolveConfiguredPreviousProductionIdentity(cwd, {
      ...env,
      [PREVIOUS_RELEASE_TAG_ENV]: canonicalIdentity.releaseTag,
      [PREVIOUS_RELEASE_COMMIT_ENV]: canonicalIdentity.releaseCommit,
    }, candidateHead);
    if (!canonicalPrevious) throw new Error("冻结 canonical previous Production identity 失败；release 已中止。");
    frozenIdentity = canonicalPrevious;
    releaseMode = "fresh";
  }

  const githubEnv = env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(
      githubEnv,
      `${PREVIOUS_RELEASE_TAG_ENV}=${frozenIdentity.releaseTag}\n` +
        `${PREVIOUS_RELEASE_COMMIT_ENV}=${frozenIdentity.releaseCommit}\n` +
        `${REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV}=1\n` +
        `${RELEASE_MODE_ENV}=${releaseMode}\n`,
      "utf8",
    );
  }
  return frozenIdentity;
}

async function readCanonicalProductionIdentity(
  env: ReleaseEnvironment,
  fetcher: ProductionReleaseFetcher,
): Promise<ReleaseIdentity> {
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
    throw new Error(`canonical Production identity 回读失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`canonical Production identity 返回 HTTP ${response.status}；release 已中止。`);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("canonical Production identity 响应不是有效 JSON；release 已中止。");
  }
  return assertReleaseIdentity(value, "canonical Production identity");
}

function sameReleaseIdentity(left: ReleaseIdentity, right: ReleaseIdentity): boolean {
  return left.releaseTag === right.releaseTag && left.releaseCommit === right.releaseCommit;
}

function resolveGitRevision(cwd: string, ref: string, label: string): string {
  if (!ref.trim() || ref.startsWith("-") || ref.includes("\0")) {
    throw new Error(`${label} 不是可解析的 Git tag/commit：${ref}`);
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("不是 commit");
    return revision;
  } catch {
    throw new Error(`${label} 无法解析为 Git tag/commit：${ref}`);
  }
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    stdio: "ignore",
  });
  return result.status === 0;
}

function listShippedSources(cwd: string, revision: string): string[] {
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "--", ...SHIPPED_SOURCE_ROOTS], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
  } catch {
    throw new Error(`previous Production commit ${revision} 的 shipped source 无法读取；release 已中止。`);
  }
}

function buildReleaseEndpoint(baseUrl: string | undefined): string {
  const configured = baseUrl === undefined ? DEFAULT_PRODUCTION_BASE_URL : baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是有效的 HTTPS origin；release 已中止。");
  }
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是无凭据、无路径的 HTTPS origin；release 已中止。");
  }
  return `${parsed.origin}${RELEASE_ENDPOINT_PATH}`;
}

async function cliMain(): Promise<void> {
  try {
    const identity = await freezeCanonicalProductionIdentity();
    console.log(`已冻结 release baseline：previous Production ${identity.releaseTag}/${identity.releaseCommit}`);
  } catch (error) {
    console.error(`冻结 release baseline 失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  void cliMain();
}
