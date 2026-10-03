import "server-only";
import { z } from "zod";
export type BroadcastStatus = "live" | "offline" | "unknown";
export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, string> = { live: "直播中", offline: "未开播", unknown: "无法确认" };
const responseSchema = z.object({ code: z.literal(0), data: z.object({ live_status: z.number().int() }) });

/** Allowlisted provider URL; 60s server cache, no browser polling of Bilibili. */
export async function readBilibiliStatus(liveStreamUrl: string | null): Promise<BroadcastStatus> {
  if (!liveStreamUrl) return "unknown";
  let room: string;
  try {
    const url = new URL(liveStreamUrl);
    if (url.protocol !== "https:" || url.hostname !== "live.bilibili.com" || !/^\/\d+\/?$/.test(url.pathname)) return "unknown";
    room = url.pathname.replaceAll("/", "");
  } catch { return "unknown"; }
  try {
    const response = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${room}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return "unknown";
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return "unknown";
    return parsed.data.data.live_status === 1 ? "live" : [0, 2].includes(parsed.data.data.live_status) ? "offline" : "unknown";
  } catch { return "unknown"; }
}
