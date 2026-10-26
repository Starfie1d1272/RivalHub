import { expect, it } from "vitest";
import { getCgroupMemorySnapshot } from "@/lib/observability/runtime-cgroup";

it.each([
  ["/system.slice/rivalhub.service", "/", "/sys/fs/cgroup/system.slice/rivalhub.service"],
  ["/", "/", "/sys/fs/cgroup"],
  ["/system.slice/rivalhub.service", "/system.slice", "/sys/fs/cgroup/rivalhub.service"],
])("reads the process subgroup rather than host totals: %s root %s", (membership, root, directory) => {
  const files: Record<string, string> = {
    "/proc/self/cgroup": `0::${membership}\n`,
    "/proc/self/mountinfo": `29 23 0:26 ${root} /sys/fs/cgroup rw - cgroup2 cgroup rw\n`,
    [`${directory}/memory.current`]: "1200\n", [`${directory}/memory.peak`]: "1600\n",
    [`${directory}/memory.events`]: "low 0\noom 2\noom_kill 1\n",
  };
  expect(getCgroupMemorySnapshot(path => { if (!(path in files)) throw Error("missing"); return files[path]; }))
    .toEqual({ cgroupCurrentBytes: 1200, cgroupPeakBytes: 1600, cgroupOom: 2, cgroupOomKill: 1 });
});

it("retains unknown for absent, denied, v1 and malformed fields; real zero remains zero", () => {
  const missing = { cgroupCurrentBytes: null, cgroupPeakBytes: null, cgroupOom: null, cgroupOomKill: null };
  expect(getCgroupMemorySnapshot(() => { throw Error("denied"); })).toEqual(missing);
  expect(getCgroupMemorySnapshot(() => "1:memory:/service\n")).toEqual(missing);
  expect(getCgroupMemorySnapshot(path => path === "/proc/self/cgroup" ? "0::/../outside\n" : "")).toEqual(missing);
  expect(getCgroupMemorySnapshot(path => ({
    "/proc/self/cgroup": "0::/\n", "/proc/self/mountinfo": "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/sys/fs/cgroup/memory.current": "0\n", "/sys/fs/cgroup/memory.peak": "max\n",
    "/sys/fs/cgroup/memory.events": "oom_kill 0\n",
  })[path] ?? "")).toEqual({ ...missing, cgroupCurrentBytes: 0, cgroupOomKill: 0 });
});
