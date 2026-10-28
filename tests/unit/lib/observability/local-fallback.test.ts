import { expect, it, vi } from "vitest";
import { logEvent } from "@/lib/observability/logger";
it("writes the local numeric sample to stdout", () => {
  const output: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation(value => { output.push(String(value)); return true; });
  try {
    expect(() => logEvent({ event: "runtime.cgroup.sample", scope: "runtime", operation: "health.sample",
      safeContext: { cgroupCurrentBytes: 100, cgroupPeakBytes: 125, cgroupOom: 0 } })).not.toThrow();
    expect(JSON.parse(output[0])).toMatchObject({ event: "runtime.cgroup.sample",
      safeContext: { cgroupCurrentBytes: 100, cgroupPeakBytes: 125, cgroupOom: 0 } });
  } finally { write.mockRestore(); }
});
