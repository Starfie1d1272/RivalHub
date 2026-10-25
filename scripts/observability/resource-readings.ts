/** Fixed Linux cgroup-v2/proc concatenation emitted by this harness's one cat. */
export function parseResourceReading(fields: string, atMs: number) {
  const numbers = fields.split("\n").filter(line => /^\d+$/.test(line)).map(Number);
  const cpuMax = fields.trim().split("\n").at(-1)!;
  const item = { atMs, rssBytes: Number(fields.match(/^VmRSS:\s+(\d+)/m)?.[1]) * 1024,
    rssPeakBytes: Number(fields.match(/^VmHWM:\s+(\d+)/m)?.[1]) * 1024,
    cgroupBytes: numbers[0]!, cgroupPeakBytes: numbers[1]!, memoryMax: numbers[2]!, swapMax: numbers[3]!, pidsMax: numbers[4]!, cpuMax };
  if (![item.rssBytes, item.rssPeakBytes, item.cgroupBytes, item.cgroupPeakBytes].every(value => Number.isFinite(value) && value > 0)
      || item.rssPeakBytes < item.rssBytes || item.cgroupPeakBytes < item.cgroupBytes) throw new Error("RESOURCE_READING_UNAVAILABLE");
  if (numbers.length !== 5 || item.memoryMax !== 536870912 || item.swapMax !== 0 || item.pidsMax !== 128 || cpuMax !== "100000 100000") throw new Error("RESOURCE_LIMIT_MISMATCH");
  return item;
}
