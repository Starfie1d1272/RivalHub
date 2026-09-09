import { describe, expect, it, vi } from "vitest";
import { dispatchCommand, hasCompletePrimaryEvidence, upsertCronJobs, validateBaseUrl } from "../../../scripts/db/scheduler";
import { SCHEDULER_JOB_DEFINITIONS, schedulerJobName } from "../../../src/lib/scheduler/definitions";

describe("production scheduler contract", () => {
  it("validates a public HTTPS origin and rejects credentials or paths", () => {
    expect(validateBaseUrl("https://match.starfie1d.top/")).toBe("https://match.starfie1d.top");
    expect(() => validateBaseUrl("http://match.starfie1d.top")).toThrow();
    expect(() => validateBaseUrl("https://user:pass@match.starfie1d.top")).toThrow();
    expect(() => validateBaseUrl("https://match.starfie1d.top/api")).toThrow();
  });

  it("uses stable named jobs and DB dispatch commands derived from the registry", () => {
    for (const definition of SCHEDULER_JOB_DEFINITIONS) {
      expect(schedulerJobName(definition.key)).toBe(`rivalhub-${definition.key}`);
      expect(dispatchCommand(definition)).toBe(
        `SELECT public.dispatch_rivalhub_scheduler_job('${definition.key}');`,
      );
    }
  });

  it("upserts named jobs directly and remains safe on repeated provisioning", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as never;

    await upsertCronJobs(pool);
    await upsertCronJobs(pool);

    expect(query).toHaveBeenCalledTimes(SCHEDULER_JOB_DEFINITIONS.length * 2);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toBe("SELECT cron.schedule($1::text, $2::text, $3::text)");
      expect(params).toHaveLength(3);
    }
  });

  it("requires fresh triggers, endpoint success, and real minute-job executions", () => {
    const verifiedAt = new Date("2026-09-10T00:00:00.000Z");
    const fresh = new Date("2026-09-10T00:00:01.000Z");
    const health = SCHEDULER_JOB_DEFINITIONS.map((definition) => ({
      job_key: definition.key,
      last_primary_triggered_at: fresh,
      last_primary_endpoint_succeeded_at: fresh,
    }));
    const runs = SCHEDULER_JOB_DEFINITIONS
      .filter((definition) => definition.primaryCron === "* * * * *")
      .map((definition) => ({ jobname: schedulerJobName(definition.key), status: "succeeded" }));

    expect(hasCompletePrimaryEvidence(verifiedAt, health, runs)).toBe(true);
    expect(hasCompletePrimaryEvidence(verifiedAt, health.map((row, index) => index === 0
      ? { ...row, last_primary_endpoint_succeeded_at: null }
      : row), runs)).toBe(false);
    expect(hasCompletePrimaryEvidence(verifiedAt, health, runs.slice(1))).toBe(false);
  });
});
