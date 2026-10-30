import type { PoolClient } from "pg";
import type { DbTrafficSource } from "./db-traffic-contract";

// These are pg 8.23's private fields. Keep all driver-specific assumptions here.
type Query = object;
type Owner = { source: DbTrafficSource; template: string } | "unsupported";
type Stream = { prependListener: (event: string, listener: (chunk: unknown) => void) => unknown };
type Connection = { attachListeners?: (stream: Stream) => unknown; on: (event: string, listener: (message: { name?: string; length?: number }) => void) => unknown };
type PgClient = PoolClient & { _activeQuery?: Query | null; _queryQueue?: Query[]; _sentQueryQueue?: Query[]; pipeline?: boolean; connection?: Connection };
type Hooks = { enabled: () => boolean; raw: (bytes: number) => void; attribute: (owner: Owner | "no_owner" | "async" | "partial" | "instrumentation", bytes: number) => void };
type Observer = { ignored: number; pending: number; prepaid: number; owner: Owner | "no_owner" | null; hooks?: Hooks; valid: boolean; attached: boolean };
const observers = new WeakMap<object, Observer>();
const owners = new WeakMap<object, Owner>();
const asyncMessages = new Set(["notice", "notification", "parameterStatus"]);

/** Install before pg attaches its parser, including on the final decrypted TLS stream. */
export function preparePgTraffic(client: PoolClient): void {
  const pg = client as PgClient; const connection = pg.connection;
  if (!connection || typeof connection.on !== "function" || typeof connection.attachListeners !== "function") return;
  const observer: Observer = { ignored: 0, pending: 0, prepaid: 0, owner: null, valid: true, attached: false };
  observers.set(client, observer);
  const invalidate = () => {
    observer.valid = false;
    const hooks = observer.hooks;
    if (hooks && hooks.enabled() && observer.pending) {
      try { hooks.attribute("instrumentation", observer.pending); observer.pending = 0; } catch { /* Keep it for partial settlement. */ }
    }
  };
  connection.on("message", message => {
    try {
      if (!observer.valid) return;
      const length = message.length;
      if (!Number.isSafeInteger(length) || length! < 4) { invalidate(); return; }
      let size = length! + 1;
      // The pre-connect bytes may include a prefix of this message. They were
      // observed before collection began, so consume them without counting them.
      const ignored = Math.min(size, observer.ignored); observer.ignored -= ignored; size -= ignored;
      const already = Math.min(size, observer.prepaid); observer.prepaid -= already; size -= already;
      const available = Math.min(size, observer.pending); observer.pending -= available;
      const hooks = observer.hooks; const name = message.name ?? "";
      if (hooks && hooks.enabled()) {
        if (available + already > 0 && !asyncMessages.has(name) && observer.owner === null) {
          const supported = "_activeQuery" in pg && Array.isArray(pg._queryQueue) && Array.isArray(pg._sentQueryQueue);
          observer.owner = !supported || pg.pipeline ? "unsupported" : pg._activeQuery ? owners.get(pg._activeQuery) ?? "unsupported" : "no_owner";
        }
        const category = size > available ? "instrumentation" : asyncMessages.has(name) ? "async" : observer.owner ?? "no_owner";
        if (available) {
          try { hooks.attribute(category, available); }
          catch { try { hooks.attribute("instrumentation", available); } catch { observer.pending += available; } }
        }
        if (size > available) invalidate();
        if (name === "readyForQuery") observer.owner = null;
      } else if (size > available) {
        // An invalid accounting sequence must never turn unknown old bytes into attribution.
        invalidate();
      }
    } catch { invalidate(); /* Never affect message dispatch. */ }
  });
  const original = connection.attachListeners;
  connection.attachListeners = function (stream: Stream) {
    // The pg connection uses this once for the plaintext parser; SSL negotiation
    // swaps in the TLS stream before this point.
    try {
      if (!observer.attached && stream && typeof stream.prependListener === "function") {
        stream.prependListener("data", chunk => {
          try {
            if (!(chunk instanceof Uint8Array)) { invalidate(); return; }
            const hooks = observer.hooks;
            if (!hooks || !hooks.enabled()) {
              if (hooks && !hooks.enabled()) resetPgTraffic(client);
              observer.ignored += chunk.byteLength;
            } else if (!observer.valid) {
              hooks.raw(chunk.byteLength); observer.pending += chunk.byteLength;
              try { hooks.attribute("instrumentation", chunk.byteLength); observer.pending -= chunk.byteLength; } catch { /* Keep bytes for partial settlement. */ }
            } else { hooks.raw(chunk.byteLength); observer.pending += chunk.byteLength; }
          } catch { invalidate(); /* Never interrupt pg's parser. */ }
        });
        observer.attached = true;
      }
    } catch { invalidate(); }
    return Reflect.apply(original, this, [stream]);
  };
}

/** Activate after connection; no bytes received before activation are counted. */
export function observePgTraffic(client: PoolClient, hooks: Hooks): boolean {
  const observer = observers.get(client);
  if (!observer?.valid || !observer.attached) return false;
  observer.hooks = hooks;
  return true;
}

export function settlePgTraffic(client: PoolClient) {
  const observer = observers.get(client); const hooks = observer?.hooks;
  if (!observer || !hooks || !observer.pending) return;
  try { const bytes = observer.pending; hooks.attribute("partial", bytes); observer.pending = 0; observer.prepaid += bytes; } catch { /* Observation is best effort. */ }
}

export function resetPgTraffic(client: PoolClient) {
  const observer = observers.get(client);
  if (observer) { observer.ignored += observer.pending + observer.prepaid; observer.pending = 0; observer.prepaid = 0; observer.owner = null; }
}

/** Compare identities before and after pg constructs/schedules its Query; never replace it. */
export function capturePgQuery(client: PoolClient): Set<Query> | null {
  try {
    const pg = client as PgClient;
    if (!Array.isArray(pg._queryQueue) || !Array.isArray(pg._sentQueryQueue) || !("_activeQuery" in pg)) return null;
    return new Set([...(pg._activeQuery ? [pg._activeQuery] : []), ...pg._queryQueue, ...pg._sentQueryQueue]);
  } catch { return null; }
}
export function bindPgQuery(client: PoolClient, before: Set<Query> | null, owner: Owner) {
  if (!before) return;
  const pg = client as PgClient;
  const after = [pg._activeQuery, ...(pg._queryQueue ?? []), ...(pg._sentQueryQueue ?? [])];
  const added = after.filter((query): query is Query => !!query && !before.has(query));
  if (added.length === 1) owners.set(added[0], owner);
}
