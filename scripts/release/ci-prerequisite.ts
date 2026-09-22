import { performance } from "node:perf_hooks";

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  path?: string;
  event: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

export interface WorkflowRunsApiResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
}

export interface CiPrerequisiteOptions {
  repository: string;
  releaseSha: string;
  releaseTag: string;
  githubToken: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  logFn?: (message: string) => void;
  errorFn?: (message: string) => void;
}

export interface CiPrerequisiteResult {
  runId: number;
  runAttempt: number;
  htmlUrl: string;
  headSha: string;
  durationMs: number;
  pollCount: number;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 900_000; // 15 minutes

export function validateRunMatchesReleasePrerequisites(
  run: GitHubWorkflowRun,
  expectedSha: string,
): { valid: true } | { valid: false; reason: string } {
  if (run.head_sha.toLowerCase() !== expectedSha.toLowerCase()) {
    return {
      valid: false,
      reason: `head_sha 不匹配：预期 ${expectedSha}，实际 ${run.head_sha}`,
    };
  }
  if (run.head_branch !== "main") {
    return {
      valid: false,
      reason: `head_branch 不是 main：实际 ${run.head_branch}`,
    };
  }
  if (run.event !== "push") {
    return {
      valid: false,
      reason: `event 不是 push：实际 ${run.event}（拒绝 PR run / schedule / workflow_dispatch / other 冒充）`,
    };
  }
  if (run.name !== "CI") {
    return {
      valid: false,
      reason: `workflow name 并非 CI：实际 name=${run.name}`,
    };
  }
  if (run.path && run.path !== ".github/workflows/ci.yml") {
    return {
      valid: false,
      reason: `workflow path 并非 .github/workflows/ci.yml：实际 path=${run.path}`,
    };
  }
  return { valid: true };
}

export function pickLatestCandidateRun(
  runs: readonly GitHubWorkflowRun[],
  expectedSha: string,
): GitHubWorkflowRun | null {
  const matches = runs.filter((run) => {
    const check = validateRunMatchesReleasePrerequisites(run, expectedSha);
    return check.valid;
  });

  if (matches.length === 0) return null;

  // Sort descending by run_attempt or created_at
  const sorted = [...matches].sort((a, b) => {
    const attemptA = a.run_attempt ?? 1;
    const attemptB = b.run_attempt ?? 1;
    if (attemptB !== attemptA) return attemptB - attemptA;
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return timeB - timeA;
  });

  return sorted[0];
}

export async function fetchCiWorkflowRuns(
  repository: string,
  commitSha: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<GitHubWorkflowRun[]> {
  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commitSha}&event=push&branch=main`;
  const response = await fetchFn(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "RivalHub-Release-Preflight",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub Actions API 请求失败：HTTP ${response.status} ${response.statusText} (${url}) ${body}`,
    );
  }

  const data = (await response.json()) as WorkflowRunsApiResponse;
  return data.workflow_runs ?? [];
}

export async function verifyExactShaCiPrerequisite(
  options: CiPrerequisiteOptions,
): Promise<CiPrerequisiteResult> {
  const {
    repository,
    releaseSha,
    releaseTag,
    githubToken,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    fetchFn = fetch,
    sleepFn = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    logFn = console.log,
    errorFn = console.error,
  } = options;

  if (!releaseSha || !/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error(`RELEASE_SHA 无效或缺失：${releaseSha}`);
  }
  if (!releaseTag || !releaseTag.startsWith("v")) {
    throw new Error(`RELEASE_TAG 无效或缺失：${releaseTag}`);
  }
  if (!repository || !repository.includes("/")) {
    throw new Error(`GITHUB_REPOSITORY 无效或缺失：${repository}`);
  }
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN 未设置；无法验证 exact-SHA CI evidence。");
  }

  const startTime = performance.now();
  let pollCount = 0;

  logFn(
    `[Release Preflight] 开始验证 exact-SHA CI evidence: tag=${releaseTag}, sha=${releaseSha}, repo=${repository}`,
  );

  while (true) {
    pollCount++;
    const elapsedMs = performance.now() - startTime;

    if (elapsedMs > pollTimeoutMs) {
      throw new Error(
        `[Release Preflight] 等待 exact-SHA CI 完成超时（已等待 ${Math.round(elapsedMs / 1000)}s，上限 ${Math.round(pollTimeoutMs / 1000)}s）。fail-closed 阻断发版。`,
      );
    }

    const runs = await fetchCiWorkflowRuns(repository, releaseSha, githubToken, fetchFn);
    const run = pickLatestCandidateRun(runs, releaseSha);

    if (!run) {
      logFn(
        `[Release Preflight] 未找到 commit ${releaseSha} 的 canonical CI push run (poll #${pollCount}, elapsed ${Math.round(elapsedMs / 1000)}s)。将在 ${Math.round(pollIntervalMs / 1000)}s 后重试...`,
      );
      await sleepFn(pollIntervalMs);
      continue;
    }

    logFn(
      `[Release Preflight] 找到 CI run id=${run.id} (attempt=${run.run_attempt ?? 1}): status=${run.status}, conclusion=${run.conclusion ?? "null"}`,
    );

    if (run.status === "completed") {
      if (run.conclusion === "success") {
        const totalDuration = performance.now() - startTime;
        logFn(
          `[Release Preflight] ✅ Exact-SHA CI evidence 通过！runId=${run.id}, conclusion=success, url=${run.html_url ?? ""}`,
        );
        return {
          runId: run.id,
          runAttempt: run.run_attempt ?? 1,
          htmlUrl: run.html_url ?? "",
          headSha: run.head_sha,
          durationMs: totalDuration,
          pollCount,
        };
      }

      // Completed with non-success conclusion
      errorFn(
        `[Release Preflight] ❌ Exact-SHA CI 未通过：runId=${run.id}, conclusion=${run.conclusion} (${run.html_url ?? ""})`,
      );
      throw new Error(
        `Release 阻断：exact release commit ${releaseSha} 的 canonical CI push run 结果为 ${run.conclusion}，未满足 success prerequisite。`,
      );
    }

    // Still in progress / queued / waiting
    logFn(
      `[Release Preflight] CI run 正在运行中 (status=${run.status})，进入 bounded poll (已等待 ${Math.round(elapsedMs / 1000)}s / 最大 ${Math.round(pollTimeoutMs / 1000)}s)... 下次检查在 ${Math.round(pollIntervalMs / 1000)}s 后`,
    );
    await sleepFn(pollIntervalMs);
  }
}

async function cliMain(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const releaseSha = process.env.RELEASE_SHA ?? "";
  const releaseTag = process.env.RELEASE_TAG ?? "";
  const githubToken = process.env.GITHUB_TOKEN ?? "";

  const pollIntervalMs = process.env.CI_POLL_INTERVAL_MS
    ? Number(process.env.CI_POLL_INTERVAL_MS)
    : DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = process.env.CI_POLL_TIMEOUT_MS
    ? Number(process.env.CI_POLL_TIMEOUT_MS)
    : DEFAULT_POLL_TIMEOUT_MS;

  try {
    await verifyExactShaCiPrerequisite({
      repository,
      releaseSha,
      releaseTag,
      githubToken,
      pollIntervalMs,
      pollTimeoutMs,
    });
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  void cliMain();
}
