export const DB_SOURCES = ["mizar", "mizar.manifest", "mizar.schedule", "mizar.live", "mizar.reliable", "mizar.claim", "mizar.release", "mizar.disconnect", "dak", "dak.pairing.start", "dak.pairing.poll", "dak.pairing.revoke", "dak.evidence.submit", "dak.events.read", "scheduler", "scheduler.settle-match-mvp", "scheduler.resolve-match-veto-timeouts", "scheduler.refresh-steam-profiles", "scheduler.reconcile-predictions", "scheduler.rebuild-statistics-projections", "scheduler.match-time-auto-award", "scheduler.draft-timeout", "scheduler.cleanup-education-evidence", "scheduler.check-registration-deadline", "match.page", "season.stage.read", "match.swiss.read", "season.lookup.fill", "admin.matches.read", "match.lineup.read", "season.catalog.fill", "stats.platform", "stats.platform.page", "stats.tournament", "stats.career", "stats.lineup", "stats.benchmark", "stats.match", "stats.fill", "bet.fill", "bet.page", "bet.read", "predictions.page", "predictions.read", "context.unmapped", "context.absent", "unknown"] as const;
export type DbTrafficSource = typeof DB_SOURCES[number];
export const DB_TEMPLATE_PATTERN = /^(?:q[0-9a-f]{16}|unknown|unsupported|overflow)$/;

/** Canonical v1 digest input preserves omitted legacy properties and array order. */
export function canonicalDbTraffic(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDbTraffic).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalDbTraffic(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function digestDbTraffic(value: unknown): Promise<string> {
  const input = new TextEncoder().encode(`db-traffic-v1:${canonicalDbTraffic(value)}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input))).map(n => n.toString(16).padStart(2, "0")).join("");
}

/** Producer-side safety gate; cross-field relationships belong to Worker quality checks. */
export function isSafeDbTrafficBatch(value: unknown): boolean {
  const keys = (input: unknown, expected: string) => !!input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).sort().join() === expected;
  const integer = (input: unknown) => typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && input <= 1e12;
  const numeric = (input: unknown) => typeof input === "number" && Number.isFinite(input) && input >= 0 && input <= 1e12;
  if (!keys(value, "at,connections,deployment,dropped,droppedReceivedBytes,id,observedConnections,process,receivedBytes,release,remaining,remainingRxBytes,rows,unconfirmedBatches,unconfirmedReceivedBytes")) return false;
  const batch = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tag = /^[A-Za-z0-9._-]{1,80}$/;
  if (typeof batch.id !== "string" || !uuid.test(batch.id) || typeof batch.process !== "string" || !uuid.test(batch.process) || typeof batch.release !== "string" || !tag.test(batch.release) || typeof batch.deployment !== "string" || !tag.test(batch.deployment) || !Number.isSafeInteger(batch.at) || (batch.at as number) < 0 || !integer(batch.connections) || (batch.connections as number) > 1000 || !integer(batch.observedConnections) || (batch.observedConnections as number) > 1000 || !integer(batch.dropped) || (batch.dropped as number) > 1000000 || ![batch.receivedBytes, batch.remainingRxBytes, batch.droppedReceivedBytes, batch.unconfirmedReceivedBytes, batch.unconfirmedBatches].every(integer)) return false;
  if (!keys(batch.remaining, "async,instrumentation,no_owner,partial,unsupported") || !Object.values(batch.remaining as object).every(integer) || !Array.isArray(batch.rows) || batch.rows.length > 80 + DB_SOURCES.length) return false;
  return batch.rows.every((row: unknown) => {
    if (!keys(row, "failures,logicalMeasuredQueries,logicalRowJsonBytes,queries,queryMs,rows,rxBytes,skipReasons,source,template")) return false;
    const item = row as Record<string, unknown>;
    return typeof item.source === "string" && (DB_SOURCES as readonly string[]).includes(item.source) && typeof item.template === "string" && DB_TEMPLATE_PATTERN.test(item.template) && [item.failures, item.logicalMeasuredQueries, item.logicalRowJsonBytes, item.queries, item.rows, item.rxBytes].every(integer) && numeric(item.queryMs) && keys(item.skipReasons, "budget,error,unsupported_value") && Object.values(item.skipReasons as object).every(integer);
  });
}
