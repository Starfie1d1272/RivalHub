import { z } from "zod";
import { PUBLIC_LIVE_MAX_BYTES, type PublicLiveMatchProjection } from "./live-projection";
import { parsePublicLiveProjection } from "./live-viewer-state";
import { clearPreviousLiveViews, LIVE_VIEW_CACHE_KEY_PREFIX } from "./live-viewer-cache-reset";

const schemaVersion = "rivalhub.previous-live.v1";
const ordinal = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contextSchema = z.strictObject({
  schemaVersion: z.literal(schemaVersion), seasonId: z.uuid(), matchId: z.uuid(),
  revision: z.string().regex(/^[a-f0-9]{64}$/), checkedAt: ordinal,
  boundary: z.strictObject({ authorityRevision: ordinal, generation: ordinal, epoch: ordinal, mapId: z.uuid() }),
});
const entrySchema = contextSchema.omit({ checkedAt: true, boundary: true }).extend({ snapshot: z.unknown() });
const entriesSchema = z.array(entrySchema).max(2);
type Context = z.infer<typeof contextSchema>;
type Entry = z.infer<typeof entrySchema>;
export interface PreviousLiveView { snapshot: PublicLiveMatchProjection; expiresAt: number }
const TTL_MS = 30000;
type StorageBackend = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Display cache only. No token, Auth identity, live watermark or event replay. */
export function createPreviousLiveViewStore(storage: StorageBackend, namespace: string) {
  const key = LIVE_VIEW_CACHE_KEY_PREFIX + namespace;
  const proofs = new Map<string, { context: Context; serverTime: number; monotonicTime: number }>();
  const savedAt = new Map<string, number>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const read = (): Entry[] => {
    try {
      const value = storage.getItem(key);
      if (!value) return [];
      if (new TextEncoder().encode(value).length > 2 * (PUBLIC_LIVE_MAX_BYTES + 4096)) throw new Error("oversized");
      return entriesSchema.parse(JSON.parse(value));
    } catch { try { storage.removeItem(key); } catch {} return []; }
  };
  const write = (entries: Entry[]) => {
    try { if (entries.length) storage.setItem(key, JSON.stringify(entries)); else storage.removeItem(key); } catch {}
  };
  const clear = (matchId: string) => {
    proofs.delete(matchId); savedAt.delete(matchId);
    clearTimeout(expiryTimers.get(matchId)); expiryTimers.delete(matchId);
    write(read().filter(entry => entry.matchId !== matchId));
  };
  const view = (snapshot: PublicLiveMatchProjection, serverNow: number, now: number): PreviousLiveView | null => {
    const receivedAt = Date.parse(snapshot.receivedAt);
    const age = serverNow - receivedAt;
    return Number.isFinite(age) && age >= 0 && age < TTL_MS ? { snapshot, expiresAt: now + TTL_MS - age } : null;
  };
  const expire = (matchId: string, delay: number) => {
    clearTimeout(expiryTimers.get(matchId));
    const timer = setTimeout(() => {
      expiryTimers.delete(matchId); savedAt.delete(matchId);
      write(read().filter(entry => entry.matchId !== matchId));
    }, delay);
    if (typeof timer === "object") timer.unref();
    expiryTimers.set(matchId, timer);
  };
  return {
    clear,
    forget(matchId: string) { proofs.delete(matchId); savedAt.delete(matchId); },
    clearAll() { proofs.clear(); savedAt.clear(); for (const timer of expiryTimers.values()) clearTimeout(timer); expiryTimers.clear(); write([]); },
    authorize(input: unknown, matchId: string, now: number, requestElapsed: number): PreviousLiveView | null {
      const parsed = contextSchema.safeParse(input);
      if (!parsed.success || parsed.data.matchId !== matchId || !Number.isFinite(requestElapsed) || requestElapsed < 0 || requestElapsed > 10000) {
        clear(matchId); return null;
      }
      const context = parsed.data;
      // Add the whole RTT conservatively: response latency cannot prolong TTL.
      const serverTime = context.checkedAt + requestElapsed;
      proofs.set(matchId, { context, serverTime, monotonicTime: now });
      const entries = read();
      const selected = entries.find(entry => entry.matchId === matchId && entry.seasonId === context.seasonId && entry.revision === context.revision);
      const snapshot = selected && parsePublicLiveProjection(selected.snapshot, matchId);
      const restored = snapshot && snapshot.map.mapId === context.boundary.mapId
        && (["authorityRevision", "generation", "epoch"] as const).every(key => snapshot.delivery[key] === context.boundary[key])
        ? view(snapshot, serverTime, now) : null;
      write(entries.filter(entry => {
        const snapshot = parsePublicLiveProjection(entry.snapshot, entry.matchId);
        return snapshot && view(snapshot, serverTime, now) && (entry.matchId !== matchId || (restored !== null && entry === selected));
      }));
      if (restored) expire(matchId, restored.expiresAt - now);
      return restored;
    },
    remember(snapshot: PublicLiveMatchProjection, now: number): PreviousLiveView | null {
      const proof = proofs.get(snapshot.matchId);
      if (!proof || now < proof.monotonicTime) return null;
      const { context } = proof;
      if (snapshot.map.mapId !== context.boundary.mapId || !(["authorityRevision", "generation", "epoch"] as const).every(key => snapshot.delivery[key] === context.boundary[key])) {
        clear(snapshot.matchId); return null;
      }
      const previous = view(snapshot, proof.serverTime + now - proof.monotonicTime, now);
      if (!previous) return null;
      expire(snapshot.matchId, previous.expiresAt - now);
      // Persist only the recorded table's public values. No source/player identity,
      // equipment detail, animated geometry, bomb event or running clock survives.
      const displaySnapshot = { ...snapshot, radar: null, bomb: null, clock: null, roundHistory: null,
        players: [...snapshot.players].sort((a, b) => a.sourcePlayerId.localeCompare(b.sourcePlayerId)).map((player, index) => ({
          ...player, sourcePlayerId: `display-${String(index + 1).padStart(3, "0")}`, canonicalPlayerId: null,
          activeWeapon: null, hasHelmet: null, hasDefuser: null, equipmentValue: null,
        })),
      };
      const entry: Entry = { schemaVersion, seasonId: context.seasonId, matchId: snapshot.matchId, revision: context.revision, snapshot: displaySnapshot };
      if (now - (savedAt.get(snapshot.matchId) ?? -Infinity) >= 1000) {
        const other = read().filter(entry => entry.matchId !== snapshot.matchId);
        write([...other.slice(-1), entry]);
        savedAt.set(snapshot.matchId, now);
      }
      return { ...previous, snapshot: displaySnapshot };
    },
  };
}
export type PreviousLiveViewStore = ReturnType<typeof createPreviousLiveViewStore>;

let browserStore: PreviousLiveViewStore | undefined;
export function browserPreviousLiveViewStore(): PreviousLiveViewStore | undefined {
  try {
    // Opener-created tabs may copy sessionStorage. They start without a baseline.
    if (window.opener) clearPreviousLiveViews();
    browserStore ??= createPreviousLiveViewStore(window.sessionStorage, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unknown");
    return browserStore;
  } catch { return undefined; }
}
