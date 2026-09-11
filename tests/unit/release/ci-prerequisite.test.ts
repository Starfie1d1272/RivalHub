import { describe, expect, it, vi } from "vitest";
import {
  pickLatestCandidateRun,
  validateRunMatchesReleasePrerequisites,
  verifyExactShaCiPrerequisite,
  type GitHubWorkflowRun,
} from "../../../scripts/release/ci-prerequisite";

const TEST_SHA = "0123456789abcdef0123456789abcdef01234567";

describe("release CI prerequisite validator", () => {
  it("accepts a matching canonical CI push run", () => {
    const run: GitHubWorkflowRun = {
      id: 101,
      name: "CI",
      head_branch: "main",
      head_sha: TEST_SHA,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
    };
    expect(validateRunMatchesReleasePrerequisites(run, TEST_SHA)).toEqual({ valid: true });
  });

  it("rejects run with mismatched SHA", () => {
    const run: GitHubWorkflowRun = {
      id: 102,
      name: "CI",
      head_branch: "main",
      head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
    };
    const result = validateRunMatchesReleasePrerequisites(run, TEST_SHA);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("head_sha 不匹配");
    }
  });

  it("rejects PR runs, schedules, and workflow_dispatch", () => {
    for (const event of ["pull_request", "schedule", "workflow_dispatch", "release"]) {
      const run: GitHubWorkflowRun = {
        id: 103,
        name: "CI",
        head_branch: "main",
        head_sha: TEST_SHA,
        path: ".github/workflows/ci.yml",
        event,
        status: "completed",
        conclusion: "success",
      };
      const result = validateRunMatchesReleasePrerequisites(run, TEST_SHA);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("event 不是 push");
      }
    }
  });

  it("rejects runs from non-main branches", () => {
    const run: GitHubWorkflowRun = {
      id: 104,
      name: "CI",
      head_branch: "feat/my-feature",
      head_sha: TEST_SHA,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
    };
    const result = validateRunMatchesReleasePrerequisites(run, TEST_SHA);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("head_branch 不是 main");
    }
  });

  it("rejects runs from non-CI workflows", () => {
    const run: GitHubWorkflowRun = {
      id: 105,
      name: "Release",
      head_branch: "main",
      head_sha: TEST_SHA,
      path: ".github/workflows/release.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
    };
    const result = validateRunMatchesReleasePrerequisites(run, TEST_SHA);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("workflow 并非 CI");
    }
  });
});

describe("pickLatestCandidateRun", () => {
  it("picks the latest attempt when multiple runs exist for same SHA", () => {
    const runs: GitHubWorkflowRun[] = [
      {
        id: 201,
        name: "CI",
        head_branch: "main",
        head_sha: TEST_SHA,
        path: ".github/workflows/ci.yml",
        event: "push",
        status: "completed",
        conclusion: "failure",
        run_attempt: 1,
      },
      {
        id: 201,
        name: "CI",
        head_branch: "main",
        head_sha: TEST_SHA,
        path: ".github/workflows/ci.yml",
        event: "push",
        status: "completed",
        conclusion: "success",
        run_attempt: 2,
      },
    ];
    const picked = pickLatestCandidateRun(runs, TEST_SHA);
    expect(picked?.run_attempt).toBe(2);
    expect(picked?.conclusion).toBe("success");
  });

  it("returns null when no matching run exists", () => {
    const runs: GitHubWorkflowRun[] = [
      {
        id: 202,
        name: "CI",
        head_branch: "main",
        head_sha: "other-sha-00000000000000000000000000000000",
        path: ".github/workflows/ci.yml",
        event: "push",
        status: "completed",
        conclusion: "success",
      },
    ];
    expect(pickLatestCandidateRun(runs, TEST_SHA)).toBeNull();
  });
});

describe("verifyExactShaCiPrerequisite orchestration", () => {
  it("fails fast if arguments are missing or malformed", async () => {
    await expect(
      verifyExactShaCiPrerequisite({
        repository: "Starfie1d1272/RivalHub",
        releaseSha: "short",
        releaseTag: "v2.9.0",
        githubToken: "fake-token",
      }),
    ).rejects.toThrow(/RELEASE_SHA 无效或缺失/);

    await expect(
      verifyExactShaCiPrerequisite({
        repository: "Starfie1d1272/RivalHub",
        releaseSha: TEST_SHA,
        releaseTag: "not-a-tag",
        githubToken: "fake-token",
      }),
    ).rejects.toThrow(/RELEASE_TAG 无效或缺失/);

    await expect(
      verifyExactShaCiPrerequisite({
        repository: "",
        releaseSha: TEST_SHA,
        releaseTag: "v2.9.0",
        githubToken: "fake-token",
      }),
    ).rejects.toThrow(/GITHUB_REPOSITORY 无效或缺失/);

    await expect(
      verifyExactShaCiPrerequisite({
        repository: "Starfie1d1272/RivalHub",
        releaseSha: TEST_SHA,
        releaseTag: "v2.9.0",
        githubToken: "",
      }),
    ).rejects.toThrow(/GITHUB_TOKEN 未设置/);
  });

  it("succeeds when candidate run has status=completed and conclusion=success", async () => {
    const mockRun: GitHubWorkflowRun = {
      id: 301,
      name: "CI",
      head_branch: "main",
      head_sha: TEST_SHA,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
      html_url: "https://github.com/Starfie1d1272/RivalHub/actions/runs/301",
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total_count: 1, workflow_runs: [mockRun] }),
    });

    const result = await verifyExactShaCiPrerequisite({
      repository: "Starfie1d1272/RivalHub",
      releaseSha: TEST_SHA,
      releaseTag: "v2.9.0",
      githubToken: "fake-token",
      fetchFn: mockFetch as unknown as typeof fetch,
      logFn: vi.fn(),
    });

    expect(result.runId).toBe(301);
    expect(result.pollCount).toBe(1);
    expect(result.htmlUrl).toBe(mockRun.html_url);
  });

  it("polls boundedly when status is in_progress then succeeds", async () => {
    let callCount = 0;
    const inProgressRun: GitHubWorkflowRun = {
      id: 302,
      name: "CI",
      head_branch: "main",
      head_sha: TEST_SHA,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "in_progress",
      conclusion: null,
      run_attempt: 1,
    };
    const completedRun: GitHubWorkflowRun = {
      ...inProgressRun,
      status: "completed",
      conclusion: "success",
    };

    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          total_count: 1,
          workflow_runs: [callCount >= 2 ? completedRun : inProgressRun],
        }),
      };
    });

    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await verifyExactShaCiPrerequisite({
      repository: "Starfie1d1272/RivalHub",
      releaseSha: TEST_SHA,
      releaseTag: "v2.9.0",
      githubToken: "fake-token",
      pollIntervalMs: 100,
      pollTimeoutMs: 5000,
      fetchFn: mockFetch as unknown as typeof fetch,
      sleepFn,
      logFn: vi.fn(),
    });

    expect(result.runId).toBe(302);
    expect(result.pollCount).toBe(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("fails closed when run conclusion is failure", async () => {
    const failedRun: GitHubWorkflowRun = {
      id: 303,
      name: "CI",
      head_branch: "main",
      head_sha: TEST_SHA,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "failure",
      run_attempt: 1,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total_count: 1, workflow_runs: [failedRun] }),
    });

    await expect(
      verifyExactShaCiPrerequisite({
        repository: "Starfie1d1272/RivalHub",
        releaseSha: TEST_SHA,
        releaseTag: "v2.9.0",
        githubToken: "fake-token",
        fetchFn: mockFetch as unknown as typeof fetch,
        logFn: vi.fn(),
        errorFn: vi.fn(),
      }),
    ).rejects.toThrow(/未满足 success prerequisite/);
  });

  it("fails closed when run conclusion is cancelled", async () => {
    const cancelledRun: GitHubWorkflowRun = {
      id: 304,
      name: "CI",
      head_branch: "main",
      head_sha: TEST_SHA,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "cancelled",
      run_attempt: 1,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total_count: 1, workflow_runs: [cancelledRun] }),
    });

    await expect(
      verifyExactShaCiPrerequisite({
        repository: "Starfie1d1272/RivalHub",
        releaseSha: TEST_SHA,
        releaseTag: "v2.9.0",
        githubToken: "fake-token",
        fetchFn: mockFetch as unknown as typeof fetch,
        logFn: vi.fn(),
        errorFn: vi.fn(),
      }),
    ).rejects.toThrow(/未满足 success prerequisite/);
  });
});
