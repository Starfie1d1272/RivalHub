import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
export type BroadcastStatus = "live" | "offline" | "unknown";
export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, string> = { live: "直播中", offline: "未开播", unknown: "无法确认" };
const responseSchema = z.object({ code: z.literal(0), data: z.object({ live_status: z.number().int() }) });
const STATUS_MAX_AGE_MS = 60_000;

function roomId(url: URL): string | null {
  if (url.protocol !== "https:" || url.hostname !== "live.bilibili.com" || url.port || url.username || url.password) return null;
  return /^\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? null;
}

function shortLink(url: URL): boolean {
  return url.protocol === "https:" && url.hostname === "b23.tv" && !url.port && !url.username && !url.password && /^\/[a-zA-Z0-9]{1,32}\/?$/.test(url.pathname);
}

/** Cache only the public short code; never forward query strings, cookies or credentials. */
async function resolveShortLink(code: string): Promise<string | null> {
  "use cache: remote";
  cacheLife({ stale: 0, revalidate: 300, expire: 301 });
  let url = new URL(`https://b23.tv/${code}`);
  const signal = AbortSignal.timeout(2500);
  try {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(url, { redirect: "manual", cache: "no-store", signal, credentials: "omit" });
      // Redirect bodies are not needed; do not buffer an unbounded provider response.
      if (response.body) void response.body.cancel().catch(() => {});
      if (![301, 302, 303, 307, 308].includes(response.status)) return null;
      const location = response.headers.get("location");
      if (!location || location.length > 2048) return null;
      const next = new URL(location, url);
      const room = roomId(next);
      if (room) return room;
      if (!shortLink(next)) return null;
      // Strip any tracking or sensitive parameters before the next request.
      url = new URL(`https://b23.tv${next.pathname}`);
    }
  } catch { /* Invalid, timed-out and unavailable links remain external links. */ }
  return null;
}

/** Shared by public and admin reads; the timestamp detects stale-while-revalidate results. */
async function readCachedRoomStatus(room: string): Promise<{ status: BroadcastStatus; checkedAt: number }> {
  "use cache: remote";
  cacheLife({ stale: 0, revalidate: 60, expire: 61 });
  let status: BroadcastStatus = "unknown";
  try {
    const response = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${room}`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const parsed = responseSchema.safeParse(await response.json());
      if (parsed.success) status = parsed.data.data.live_status === 1 ? "live" : [0, 2].includes(parsed.data.data.live_status) ? "offline" : "unknown";
    }
  } catch { /* A failed provider read remains unknown. */ }
  return { status, checkedAt: Date.now() };
}

export function freshBroadcastStatus(result: { status: BroadcastStatus; checkedAt: number }, now: number): BroadcastStatus {
  return now >= result.checkedAt && now - result.checkedAt < STATUS_MAX_AGE_MS ? result.status : "unknown";
}

export async function readBilibiliRoom(liveStreamUrl: string | null): Promise<{ roomId: string | null; status: BroadcastStatus }> {
  const unknown = { roomId: null, status: "unknown" as const };
  if (!liveStreamUrl) return unknown;
  let room: string | null;
  try {
    const url = new URL(liveStreamUrl);
    room = roomId(url);
    if (!room && shortLink(url)) room = await resolveShortLink(url.pathname.replaceAll("/", ""));
  } catch { return unknown; }
  if (!room) return unknown;
  return { roomId: room, status: freshBroadcastStatus(await readCachedRoomStatus(room), Date.now()) };
}

export async function readBilibiliStatus(liveStreamUrl: string | null): Promise<BroadcastStatus> {
  return (await readBilibiliRoom(liveStreamUrl)).status;
}
