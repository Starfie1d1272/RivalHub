import { describe, expect, it } from "vitest";
import {
  SCHEDULER_JOB_DEFINITIONS,
  getSchedulerJobDefinition,
  getSchedulerRoute,
  isSchedulerSource,
  schedulerJobName,
} from "@/lib/scheduler/definitions";

describe("scheduler definitions", () => {
  it("keeps one provider-neutral registry with the Beijing cleanup schedule", () => {
    expect(SCHEDULER_JOB_DEFINITIONS).toHaveLength(4);
    expect(getSchedulerJobDefinition("cleanup-education-evidence")).toMatchObject({
      primaryCron: "0 22 * * *",
      staleAfterMs: 36 * 60 * 60 * 1000,
    });
    expect(getSchedulerRoute(SCHEDULER_JOB_DEFINITIONS[0]!.key)).toBe("/api/cron/draft-timeout");
    expect(schedulerJobName("draft-timeout")).toBe("rivalhub-draft-timeout");
  });

  it("accepts only registered scheduler sources", () => {
    expect(isSchedulerSource("supabase-primary")).toBe(true);
    expect(isSchedulerSource("legacy")).toBe(true);
    expect(isSchedulerSource("browser")).toBe(false);
    expect(isSchedulerSource(null)).toBe(false);
  });
});
