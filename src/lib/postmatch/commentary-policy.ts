import type { Match } from "@/db/schema";

/** Shared self-service boundary; callers read these facts under the match lock before writing. */
export function commentaryCancellationBlocker(facts: {
  status: Match["status"];
  vetoStartedAt: Date | null;
  activeSourceId: string | null;
}): string | null {
  if (facts.status === "finished") return "比赛已结束，不能取消认领。";
  if (facts.status === "cancelled") return "比赛已取消，不能取消认领。";
  if (facts.status !== "scheduled" || facts.vetoStartedAt) return "BP 或比赛已开始，请联系管理员调整解说安排。";
  if (facts.activeSourceId) return "本场已进入制作准备，请联系管理员调整解说安排。";
  return null;
}
