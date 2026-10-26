import { expect, it, vi } from "vitest";
import { logEvent } from "@/lib/observability/logger";
vi.mock("@opentelemetry/api-logs", () => ({
  logs: { getLogger: () => ({ emit() { throw Error("fixture provider unavailable"); } }) },
  SeverityNumber: { INFO: 9 },
}));
it("retains the local numeric sample when the external exporter throws", () => {
  const output: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation(value => { output.push(String(value)); return true; });
  try {
    expect(() => logEvent({ event: "runtime.cgroup.sample", scope: "runtime", operation: "health.sample",
      safeContext: { cgroupCurrentBytes: 100, cgroupPeakBytes: 125, cgroupOom: 0 } })).not.toThrow();
    expect(JSON.parse(output[0])).toMatchObject({ event: "runtime.cgroup.sample",
      safeContext: { cgroupCurrentBytes: 100, cgroupPeakBytes: 125, cgroupOom: 0 } });
  } finally { write.mockRestore(); }
});
