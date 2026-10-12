import { describe, expect, it, vi } from "vitest";
import { validateRunMatchesReleasePrerequisites, verifyExactShaCiPrerequisite, type GitHubWorkflowRun } from "../../../scripts/release/ci-prerequisite";

const TEST_SHA = "0123456789abcdef0123456789abcdef01234567";

describe("release CI prerequisite validator", () => {

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

});

describe("verifyExactShaCiPrerequisite orchestration", () => {

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

});
