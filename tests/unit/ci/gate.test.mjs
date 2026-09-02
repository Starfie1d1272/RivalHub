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
      REQUIRED_JOBS: "[]",
      ...overrides,
    },
  });
}

describe("ci-gate", () => {
  it("accepts planner-declared skipped evidence", () => {
    const result = runGate({ REQUIRED_JOBS: '["static"]', STATIC_RESULT: "success" });
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
