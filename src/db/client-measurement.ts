import type { PoolClient } from "pg";
import { dbTrafficSource, recordDbTraffic, queryShape, dbTrafficEnabled } from "../lib/observability/db-traffic";
import { getObservabilityContext } from "../lib/observability/context";

const OPERATIONS = ["select", "with", "insert", "update", "delete", "begin", "commit", "rollback", "rollback_to", "set", "savepoint", "release"];
export function createClientMeasurements() {
  return { queries: 0, failures: 0, rows: 0, queryMs: 0, unsupported: 0, checkouts: 0, holdMs: 0, holdMaxMs: 0, holdBuckets: [0, 0, 0, 0, 0], inFlight: 0, peak: 0,
    transactions: 0, transactionMs: 0, committed: 0, rolledBack: 0, unfinished: 0 };
}

// Bound traversal before serialization, including nested values and strings. Unusual
// objects, cycles, accessors and oversized results are deliberately left unmeasured.
function logicalBytes(result: unknown): number | undefined {
  try {
    const results = Array.isArray(result) ? result : [result];
    let budget = 100000, bytes = 0;
    const seen = new Set<object>();
    const inspect = (value: unknown): boolean => {
      if (--budget < 0) return false;
      if (typeof value === "string") { budget -= value.length; return budget >= 0; }
      if (value === null || typeof value === "number" || typeof value === "boolean") return true;
      if (typeof value !== "object" || seen.has(value)) return false;
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
      seen.add(value);
      for (const key of Object.keys(value)) {
        budget -= key.length;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (budget < 0 || !descriptor || !("value" in descriptor) || !inspect(descriptor.value)) return false;
      }
      seen.delete(value);
      return true;
    };
    for (const item of results) {
      if (!item || typeof item !== "object") return undefined;
      const rows = Object.getOwnPropertyDescriptor(item, "rows")?.value;
      if (!Array.isArray(rows)) return undefined;
      for (const row of rows) {
        if (!inspect(row)) return undefined;
        const json = JSON.stringify(row);
        if (json === undefined) return undefined;
        bytes += Buffer.byteLength(json, "utf8");
      }
    }
    return bytes;
  } catch { return undefined; }
}

/** Per-lease instrumentation: restore pg methods before returning the client to the pool. */
export function measureClient(client: PoolClient, totals: ReturnType<typeof createClientMeasurements>): PoolClient["release"] {
  const originalQueryDescriptor = Object.getOwnPropertyDescriptor(client, "query");
  const originalQuery = client.query;
  const originalRelease = client.release;
  const heldAt = performance.now();
  totals.inFlight++;
  totals.peak = Math.max(totals.peak, totals.inFlight);
  let transaction: { started: number } | null = null;
  let released = false;
  client.query = function (...args: unknown[]) {
    const first = args[0];
    let source: ReturnType<typeof dbTrafficSource> = "unknown";
    try { source = dbTrafficSource(getObservabilityContext().route); } catch { /* Observation is best effort. */ }
    // Custom Query/Submittable objects own their callback/emitter semantics.
    // Preserve them verbatim and explicitly report the coverage gap.
    if (first && typeof first === "object" && ("submit" in first || "callback" in first)) {
      totals.unsupported++;
      try { recordDbTraffic(source, "unsupported", 0, 0, false); } catch { /* Observation is best effort. */ }
      return Reflect.apply(originalQuery, client, args);
    }
    const text = typeof first === "string" ? first : first && typeof first === "object" ? Object.getOwnPropertyDescriptor(first, "text")?.value : undefined;
    const token = typeof text === "string" ? (text.trim().match(/^[a-z]+/i)?.[0].toLowerCase() ?? "unknown") : "unknown";
    const operation = token === "rollback" && typeof text === "string" && /^rollback\s+to\b/i.test(text.trim()) ? "rollback_to" : OPERATIONS.includes(token) ? token : "unknown";
    const started = performance.now();
    totals.queries++;
    if (operation === "begin" && !transaction) transaction = { started };
    let finished = false;
    const finish = (error: unknown, result?: unknown) => {
      if (finished) return;
      finished = true;
      const elapsed = performance.now() - started;
      const count = result && typeof result === "object" ? Object.getOwnPropertyDescriptor(result, "rowCount")?.value : undefined;
      const rows = typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
      totals.failures += error ? 1 : 0;
      totals.rows += rows;
      totals.queryMs += elapsed;
      try { if (dbTrafficEnabled()) recordDbTraffic(source, queryShape(text), rows, elapsed, !!error, error ? undefined : logicalBytes(result)); } catch { /* Observation is best effort. */ }
      if (transaction && ((operation === "commit" || operation === "rollback") || (operation === "begin" && error))) {
        const held = performance.now() - transaction.started;
        totals.transactions++;
        totals.transactionMs += held;
        if (error) totals.unfinished++;
        else if (operation === "commit" && !(result && typeof result === "object" && Object.getOwnPropertyDescriptor(result, "command")?.value === "ROLLBACK")) totals.committed++;
        else totals.rolledBack++;
        transaction = null;
      }
    };
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
        finish(values[0], values[1]);
        return Reflect.apply(callback, this, values);
      };
    }
    try {
      const result = Reflect.apply(originalQuery, client, args);
      if (typeof callback === "function") return result;
      return result.then((value: unknown) => { finish(null, value); return value; }, (error: unknown) => { finish(error); throw error; });
    } catch (error) { finish(error); throw error; }
  } as PoolClient["query"];
  const release: PoolClient["release"] = (error) => {
    if (!released) {
      released = true;
      if (originalQueryDescriptor) Object.defineProperty(client, "query", originalQueryDescriptor);
      else Reflect.deleteProperty(client, "query");
      client.release = originalRelease;
      totals.checkouts++;
      const heldMs = performance.now() - heldAt;
      totals.inFlight--;
      totals.holdMs += heldMs;
      totals.holdMaxMs = Math.max(totals.holdMaxMs, heldMs);
      totals.holdBuckets[heldMs <= 1 ? 0 : heldMs <= 10 ? 1 : heldMs <= 100 ? 2 : heldMs <= 1000 ? 3 : 4]++;
      if (transaction) {
        const held = performance.now() - transaction.started;
        totals.transactions++;
        totals.transactionMs += held;
        totals.unfinished++;
        transaction = null;
      }
    }
    // Never swallow duplicate-release or connection errors, and never retry.
    return originalRelease.call(client, error);
  };
  client.release = release;
  return release;
}
