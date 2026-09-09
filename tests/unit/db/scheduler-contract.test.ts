import { describe, expect, it } from "vitest";
import { dispatchCommand, validateBaseUrl } from "../../../scripts/db/scheduler";
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
});
