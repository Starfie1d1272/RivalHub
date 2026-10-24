import { z } from "zod";
import { isHttpUrl } from "@/lib/external-url";

export const recordingInput = z.object({
  id: z.guid(),
  commentatorUserId: z.guid(),
  title: z.string().trim().min(1).max(100),
  url: z.string().trim().max(2000).refine(value => {
    if (!isHttpUrl(value)) return false;
    const url = new URL(value);
    return !url.username && !url.password;
  }, "请填写不含登录信息的 http 或 https 录像链接"),
}).strict();
export type MatchRecording = z.infer<typeof recordingInput>;
export function hasMatchRecording(match: { videoUrl: string | null; recordings?: MatchRecording[] }): boolean {
  return Boolean(match.videoUrl) || Boolean(match.recordings?.length);
}
