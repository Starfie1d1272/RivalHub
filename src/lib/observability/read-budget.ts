import "server-only";

const FAMILIES = ["match", "schedule"] as const;
type Family = typeof FAMILIES[number];
type ReadCounter = { requests: number; status200: number; status304: number; failures: number; other: number;
  encodedResponses: number; encodedBodyBytes: number };
const SLOT = Symbol.for("rivalhub.read-budget.v1");
function owner() {
  const host = process as unknown as Record<symbol, { mizar: Record<Family, ReadCounter>; betFallbacks: number }>;
  return host[SLOT] ??= { mizar: Object.fromEntries(FAMILIES.map(name => [name, {
    requests: 0, status200: 0, status304: 0, failures: 0, other: 0,
    encodedResponses: 0, encodedBodyBytes: 0,
  }])) as Record<Family, ReadCounter>, betFallbacks: 0 };
}

export function recordMizarHttpResult(family: Family, status: number | undefined): void {
  if (!FAMILIES.includes(family)) return;
  const value = owner().mizar[family];
  value.requests++;
  if (status === 200) value.status200++;
  else if (status === 304) value.status304++;
  else if (status === undefined || status >= 400) value.failures++;
  else value.other++;
}

/** Already encoded context body only; excludes errors, HTTP framing and compression. */
export function recordMizarEncodedBody(family: Family, bytes: number): void {
  if (!FAMILIES.includes(family) || !Number.isSafeInteger(bytes) || bytes < 0) return;
  const value = owner().mizar[family];
  value.encodedResponses++;
  value.encodedBodyBytes += bytes;
}

export function recordBetAggregateFallback(): void { owner().betFallbacks++; }

/** Cumulative process counters; restart resets them. No request identifiers or samples. */
export function getReadBudgetSnapshot() {
  return { mizar: FAMILIES.map(family => ({ family, ...owner().mizar[family] })), betFallbacks: owner().betFallbacks };
}
