import { LIMITS, type ClientContext, type TelemetryEvent } from "../../src/lib/telemetry/protocol";

/** Native gzip only on the independent receiver; the browser sends bounded JSON. */
export async function compressEvents(events: TelemetryEvent[]): Promise<ArrayBuffer> {
  const stream = new Blob([JSON.stringify(events)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** D1 returns BLOBs as byte arrays; local SQLite returns Uint8Array. Bound decoded size too. */
export async function decompressEvents(blob: number[] | Uint8Array): Promise<string> {
  const stream = new Blob([Uint8Array.from(blob)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bytes) { await reader.cancel(); throw new Error("Invalid stored batch size"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** Identity-free per-batch counts let approved rollups avoid decompressing a whole day. */
export function batchSummary(events: TelemetryEvent[]): string {
  const groups = new Map<string, { dimensions: string[]; events: number; duration: number; score: number; client?: ClientContext; sampleId?: string; at?: number }>();
  for (const e of events) {
    const dimensions = [e.scene, e.route, e.kind, e.operation ?? "", e.phase ?? "", e.outcome ?? "", e.kind === "performance" ? e.metricName ?? "" : e.variant ?? ""];
    const key = JSON.stringify([dimensions, e.client ?? null, e.kind === "performance" ? e.id : null]);
    const group = groups.get(key) ?? { dimensions, events: 0, duration: 0, score: 0, client: e.client, ...(e.kind === "performance" ? { sampleId: e.id, at: e.at } : {}) };
    group.events++; group.duration += e.durationMs ?? 0; group.score += e.score ?? 0; groups.set(key, group);
  }
  return JSON.stringify([...groups.values()].map(g => {
    const row = [...g.dimensions, g.events, g.duration];
    const score = g.dimensions[6] === "CLS" ? Math.round(g.score * 10000) / 10000 : null;
    return g.sampleId ? [...row, score, g.client ?? null, g.sampleId, g.at]
      : g.client ? [...row, score, g.client] : row;
  }));
}
