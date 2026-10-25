import "server-only";

// Fixed process-wide counters, shared by API/RSC graphs. No request data or samples.
export const RUNTIME_RESOURCE_NAMES = [
  "telemetry.dashboard.fill", "stats.public.fill", "profile.public.read", "mizar.live", "mizar.reliable",
] as const;
export type RuntimeResourceName = typeof RUNTIME_RESOURCE_NAMES[number];
const SLOT = Symbol.for("rivalhub.runtime-resources.v1");
type Counter = { inFlight: number; peak: number; count: number; totalMs: number; maxMs: number };
function counters(): Record<RuntimeResourceName, Counter> {
  const host = process as unknown as Record<symbol, Record<RuntimeResourceName, Counter>>;
  return host[SLOT] ??= Object.fromEntries(RUNTIME_RESOURCE_NAMES.map(name => [name,
    { inFlight: 0, peak: 0, count: 0, totalMs: 0, maxMs: 0 },
  ])) as Record<RuntimeResourceName, Counter>;
}

/** Call the returned completion in finally; duplicate completion is harmless. */
export function beginRuntimeResource(name: RuntimeResourceName): () => void {
  if (!RUNTIME_RESOURCE_NAMES.includes(name)) return () => {};
  const value = counters()[name];
  const started = performance.now();
  value.inFlight++;
  value.peak = Math.max(value.peak, value.inFlight);
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    value.inFlight--;
    value.count++;
    const elapsed = performance.now() - started;
    value.totalMs += elapsed;
    value.maxMs = Math.max(value.maxMs, elapsed);
  };
}

export function getRuntimeResourceSnapshot() {
  return RUNTIME_RESOURCE_NAMES.map(name => ({ name, ...counters()[name] }));
}
