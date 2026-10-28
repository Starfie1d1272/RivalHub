import "server-only";
import { cacheLife } from "next/cache";
import { z } from "zod";
export type BroadcastStatus = "live" | "offline" | "unknown";
export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, string> = { live: "直播中", offline: "未开播", unknown: "无法确认" };
const responseSchema = z.object({ code: z.literal(0), data: z.object({ live_status: z.number().int() }) });
const STATUS_MAX_AGE_MS = 60_000;

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

export async function readBilibiliStatus(liveStreamUrl: string | null): Promise<BroadcastStatus> {
  if (!liveStreamUrl) return "unknown";
  let room: string;
  try {
    const url = new URL(liveStreamUrl);
    if (url.protocol !== "https:" || url.hostname !== "live.bilibili.com" || !/^\/\d+\/?$/.test(url.pathname)) return "unknown";
    room = url.pathname.replaceAll("/", "");
  } catch { return "unknown"; }
  return freshBroadcastStatus(await readCachedRoomStatus(room), Date.now());
}
