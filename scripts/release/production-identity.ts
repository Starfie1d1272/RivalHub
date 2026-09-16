import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { assertReleaseIdentity, type ReleaseIdentity } from "../../src/lib/release/identity";

export const PREVIOUS_RELEASE_TAG_ENV = "RIVALHUB_PREVIOUS_RELEASE_TAG";
export const PREVIOUS_RELEASE_COMMIT_ENV = "RIVALHUB_PREVIOUS_RELEASE_COMMIT";
export const REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV = "RIVALHUB_REQUIRE_EXPLICIT_PREVIOUS_RELEASE";

const DEFAULT_PRODUCTION_BASE_URL = "https://match.starfie1d.top";
const RELEASE_ENDPOINT_PATH = "/api/system/release";
const RELEASE_READBACK_TIMEOUT_MS = 10_000;
const SHIPPED_SOURCE_ROOTS = ["src", "scripts"] as const;

export type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;
export type ProductionReleaseFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * 解析发布消费者收到的唯一一组显式上一生产版本身份标识。返回 null
 * 仅供主动选择 Git 推导兼容性辅助函数的开发环境/持续集成调用者使用；
 * 生产环境调用者必须要求这组身份标识存在。
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
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} 与 ${PREVIOUS_RELEASE_COMMIT_ENV} 必须同时提供；拒绝使用不完整的上一生产版本身份标识。`);
  }

  let identity: ReleaseIdentity;
  try {
    identity = assertReleaseIdentity({ releaseTag: tag.trim(), releaseCommit: commit.trim() }, "上一生产版本身份标识");
  } catch (error) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV}/${PREVIOUS_RELEASE_COMMIT_ENV} 无效：${error instanceof Error ? error.message : String(error)}`);
  }

  const taggedCommit = resolveGitRevision(cwd, `refs/tags/${identity.releaseTag}`, `${PREVIOUS_RELEASE_TAG_ENV} tag`);
  if (taggedCommit.toLowerCase() !== identity.releaseCommit) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} 与 ${PREVIOUS_RELEASE_COMMIT_ENV} 不匹配：tag 指向 ${taggedCommit}，配置为 ${identity.releaseCommit}。`);
  }

  const candidateCommit = resolveGitRevision(cwd, candidateHead, "候选版本提交");
  if (candidateCommit.toLowerCase() === identity.releaseCommit) {
    throw new Error(`${PREVIOUS_RELEASE_TAG_ENV} ${identity.releaseTag} 与候选版本相同；上一生产版本身份标识必须早于候选版本。`);
  }
  if (!isAncestor(cwd, identity.releaseCommit, candidateCommit)) {
    throw new Error(`上一生产版本提交 ${identity.releaseCommit} 不在候选版本 ${candidateCommit} 的 main 提交链上；拒绝猜测发布基线。`);
  }

  const shippedSource = listShippedSources(cwd, identity.releaseCommit);
  if (shippedSource.length === 0) {
    throw new Error(`上一生产版本提交 ${identity.releaseCommit} 不包含已发布源代码；拒绝将其作为发布基线。`);
  }

  return identity;
}

/** 在发布执行任何写操作前冻结权威生产版本身份标识。 */
export async function freezeCanonicalProductionIdentity(options: {
  cwd?: string;
  env?: ReleaseEnvironment;
  fetcher?: ProductionReleaseFetcher;
  candidateHead?: string;
} = {}): Promise<ReleaseIdentity> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const endpoint = buildReleaseEndpoint(env.RIVALHUB_PRODUCTION_BASE_URL);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(RELEASE_READBACK_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`权威生产版本身份标识回读失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`权威生产版本身份标识返回 HTTP ${response.status}；发布已中止。`);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("权威生产版本身份标识响应不是有效 JSON；发布已中止。");
  }
  const canonicalIdentity = assertReleaseIdentity(value, "权威生产版本身份标识");
  const candidateHead = options.candidateHead ?? env.RIVALHUB_MIGRATION_HEAD_SHA?.trim() ?? "HEAD";
  const frozenIdentity = resolveConfiguredPreviousProductionIdentity(cwd, {
    ...env,
    [PREVIOUS_RELEASE_TAG_ENV]: canonicalIdentity.releaseTag,
    [PREVIOUS_RELEASE_COMMIT_ENV]: canonicalIdentity.releaseCommit,
  }, candidateHead);
  if (!frozenIdentity) throw new Error("冻结权威生产版本身份标识失败；发布已中止。");

  const githubEnv = env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(githubEnv, `${PREVIOUS_RELEASE_TAG_ENV}=${frozenIdentity.releaseTag}\n${PREVIOUS_RELEASE_COMMIT_ENV}=${frozenIdentity.releaseCommit}\n${REQUIRE_EXPLICIT_PREVIOUS_RELEASE_ENV}=1\n`, "utf8");
  }
  return frozenIdentity;
}

function resolveGitRevision(cwd: string, ref: string, label: string): string {
  if (!ref.trim() || ref.startsWith("-") || ref.includes("\0")) {
    throw new Error(`${label} 不是可解析的 Git tag/提交：${ref}`);
  }
  try {
    const revision = execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("不是提交");
    return revision;
  } catch {
    throw new Error(`${label} 无法解析为 Git tag/提交：${ref}`);
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
    throw new Error(`上一生产版本提交 ${revision} 的已发布源代码无法读取；发布已中止。`);
  }
}

function buildReleaseEndpoint(baseUrl: string | undefined): string {
  const configured = baseUrl === undefined ? DEFAULT_PRODUCTION_BASE_URL : baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是有效的 HTTPS 来源地址；发布已中止。");
  }
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new Error("RIVALHUB_PRODUCTION_BASE_URL 必须是无凭据、无路径的 HTTPS 来源地址；发布已中止。");
  }
  return `${parsed.origin}${RELEASE_ENDPOINT_PATH}`;
}

async function cliMain(): Promise<void> {
  try {
    const identity = await freezeCanonicalProductionIdentity();
    console.log(`已冻结发布身份标识：上一生产版本 ${identity.releaseTag}/${identity.releaseCommit}`);
  } catch (error) {
    console.error(`冻结发布身份标识失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  void cliMain();
}
