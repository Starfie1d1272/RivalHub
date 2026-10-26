import "server-only";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const unknown = () => ({ cgroupCurrentBytes: null, cgroupPeakBytes: null, cgroupOom: null, cgroupOomKill: null });
type CgroupMemory = { [K in keyof ReturnType<typeof unknown>]: number | null };
const unescapePath = (value: string) => value.replace(/\\(040|011|012|134)/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));

/** Resolve this process's v2 mount, including a systemd subgroup or namespace root. */
function memoryDirectory(read: (path: string) => string): string | null {
  const membership = read("/proc/self/cgroup").split("\n").find(line => line.startsWith("0::"))?.slice(3);
  if (!membership?.startsWith("/") || membership.split("/").includes("..")) return null;
  for (const line of read("/proc/self/mountinfo").split("\n")) {
    const [mount, kind] = line.split(" - ");
    if (!kind?.startsWith("cgroup2 ")) continue;
    const fields = mount.split(" ");
    const root = unescapePath(fields[3] ?? "");
    const destination = unescapePath(fields[4] ?? "");
    if (!root.startsWith("/") || !destination.startsWith("/")) continue;
    if (membership !== root && root !== "/" && !membership.startsWith(root + "/")) continue;
    return posix.join(destination, posix.relative(root, membership));
  }
  return null;
}

/** Small virtual files once per existing sampler tick; absent/v1/denied is unknown. */
export function getCgroupMemorySnapshot(read: (path: string) => string = path => readFileSync(path, "utf8")): CgroupMemory {
  const result: CgroupMemory = unknown();
  try {
    const directory = memoryDirectory(read);
    if (!directory) return result;
    const number = (text: string) => /^\d+$/.test(text.trim()) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
    const optional = (file: string) => { try { return read(posix.join(directory, file)); } catch { return ""; } };
    result.cgroupCurrentBytes = number(optional("memory.current"));
    result.cgroupPeakBytes = number(optional("memory.peak"));
    const events = optional("memory.events");
    result.cgroupOom = number(events.match(/^oom (\d+)$/m)?.[1] ?? "");
    result.cgroupOomKill = number(events.match(/^oom_kill (\d+)$/m)?.[1] ?? "");
  } catch { /* No path, host membership, or raw error is logged. */ }
  return result;
}
