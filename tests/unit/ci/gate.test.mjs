import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const gatePath = resolve(process.cwd(), "scripts/ci/gate.mjs");

function runGate(overrides) {
  return spawnSync(process.execPath, [gatePath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PLAN_RESULT: "success",
      STATIC_RESULT: "skipped",
      POSTGRES_RESULT: "skipped",
      SYSTEM_RESULT: "skipped",
      DEPENDENCY_REVIEW_RESULT: "skipped",
      DEPENDENCY_GRAPH_BUILD_RESULT: "success",
      DEPENDENCY_GRAPH_SUBMIT_RESULT: "success",
      DEPENDENCY_GRAPH_READBACK_RESULT: "skipped",
      REQUIRE_GRAPH_READBACK: "false",
      EVENT_NAME: "push",
      REQUIRED_JOBS: "[]",
      ...overrides,
    },
  });
}

describe("ci-gate", () => {
  it("requires complete graph submission and default-branch read-back, never allowing a skipped submission", () => {
    for (const key of ["DEPENDENCY_GRAPH_BUILD_RESULT", "DEPENDENCY_GRAPH_SUBMIT_RESULT"]) {
      for (const status of ["failure", "cancelled", "skipped", undefined]) {
        expect(runGate({ [key]: status }).status).not.toBe(0);
      }
    }
    expect(runGate({ REQUIRE_GRAPH_READBACK: "true", DEPENDENCY_GRAPH_READBACK_RESULT: "success" }).status).toBe(0);
    for (const status of ["skipped", "failure", undefined]) {
      expect(runGate({ REQUIRE_GRAPH_READBACK: "true", DEPENDENCY_GRAPH_READBACK_RESULT: status }).status).not.toBe(0);
    }
  });
  it("accepts planner-declared skipped evidence", () => {
    const result = runGate({ REQUIRED_JOBS: '["static"]', STATIC_RESULT: "success" });
    expect(result.status).toBe(0);
  });

  it("requires dependency review on pull requests", () => {
    const passed = runGate({ EVENT_NAME: "pull_request", DEPENDENCY_REVIEW_RESULT: "success" });
    expect(passed.status).toBe(0);

    for (const status of ["skipped", "failure", "cancelled", undefined]) {
      const result = runGate({ EVENT_NAME: "pull_request", DEPENDENCY_REVIEW_RESULT: status });
      expect(result.status, status).not.toBe(0);
    }
  });

  it("accepts the expected skipped dependency review outside pull requests", () => {
    const result = runGate({ EVENT_NAME: "merge_group", DEPENDENCY_REVIEW_RESULT: "skipped" });
    expect(result.status).toBe(0);
  });

  it("rejects required skipped, failed, or cancelled evidence", () => {
    for (const status of ["skipped", "failure", "cancelled"]) {
      const result = runGate({ REQUIRED_JOBS: '["postgres"]', POSTGRES_RESULT: status });
      expect(result.status, status).not.toBe(0);
    }
  });

  it("rejects an unexpected optional failure", () => {
    const result = runGate({ SYSTEM_RESULT: "failure" });
    expect(result.status).not.toBe(0);
  });
});
