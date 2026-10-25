import { expect, it } from "vitest";
import { parseResourceReading } from "../../scripts/observability/resource-readings";

const proc = "Name:\tnode\nVmRSS:\t100000 kB\nVmHWM:\t120000 kB\n";
const cgroup = "100000000\n130000000\n536870912\n0\n128\n100000 100000\n";

it("keeps process RSS and cgroup charge as distinct byte readings with actual limits", () => {
  expect(parseResourceReading(proc + cgroup, 42)).toMatchObject({ atMs: 42, rssBytes: 102400000, rssPeakBytes: 122880000,
    cgroupBytes: 100000000, cgroupPeakBytes: 130000000, memoryMax: 536870912, swapMax: 0, pidsMax: 128 });
});

it("rejects absent process high-water data instead of serializing unknown as zero/null", () => {
  expect(() => parseResourceReading(proc.replace("VmHWM:\t120000 kB\n", "") + cgroup, 0)).toThrow("RESOURCE_READING_UNAVAILABLE");
});

it("rejects resource-limit drift rather than presenting it as a comparable run", () => {
  for (const drift of [cgroup.replace("536870912", "1073741824"), cgroup.replace("\n0\n", "\n536870912\n"), cgroup.replace("100000 100000", "200000 100000")]) {
    expect(() => parseResourceReading(proc + drift, 0)).toThrow("RESOURCE_LIMIT_MISMATCH");
  }
});
