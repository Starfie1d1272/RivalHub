import { expect, it, vi } from "vitest";
import { logEvent, tryLogEvent } from "@/lib/observability/logger";
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


it("reports local stream handoff or failure without changing the request", () => {
  const write = vi.spyOn(process.stdout, "write");
  try {
    write.mockReturnValue(false); // Backpressure still accepts the write.
    expect(tryLogEvent({ event: "fixture.reject", scope: "mizar", operation: "reliable", requestId: "fixture" })).toBe(true);
    write.mockImplementation(() => { throw new Error("sink unavailable"); });
    expect(tryLogEvent({ event: "fixture.reject", scope: "mizar", operation: "reliable", requestId: "fixture" })).toBe(false);
  } finally { write.mockRestore(); }
});
