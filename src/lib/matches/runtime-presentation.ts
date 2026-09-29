import type { MatchStatus } from "@/types/match";

export type MatchPresentationPhase = "preparing" | "waiting_veto" | "veto" | "waiting_gameplay" | "gameplay" | "inter_map" | "post";
export const MATCH_PHASE_LABELS: Record<MatchPresentationPhase, string> = {
  preparing: "赛前准备", waiting_veto: "等待 BP", veto: "BP 进行中", waiting_gameplay: "等待正式对局",
  gameplay: "正式对局", inter_map: "图间", post: "赛后",
};
export function deriveMatchPresentationPhase(input: {
  status: MatchStatus; lineupsReady: boolean; vetoStarted: boolean; vetoCompleted: boolean;
  mapExecution: "waiting" | "gameplay" | "inter_map"; completedMaps: number; currentMapCompleted?: boolean;
}): MatchPresentationPhase {
  if (input.status === "finished" || input.status === "cancelled") return "post";
  if (!input.vetoStarted) return input.lineupsReady ? "waiting_veto" : "preparing";
  if (!input.vetoCompleted) return "veto";
  if (input.currentMapCompleted) return "inter_map";
  if (input.mapExecution === "gameplay") return "gameplay";
  if (input.mapExecution === "inter_map" || input.completedMaps > 0) return "inter_map";
  return "waiting_gameplay";
}

export type MatchOperationalTask = "schedule" | "lineup" | "veto" | "result" | "review" | "post" | "none";
export function projectMatchPrimaryTask(input: { phase: MatchPresentationPhase; needsAttention: boolean; scheduledAt: Date | null; isAdmin: boolean; isTeamRepresentative: boolean; isBpRepresentative: boolean; lineupsReady: boolean }): { key: MatchOperationalTask; label: string } {
  if (input.isAdmin && input.needsAttention) return { key: "review", label: "处理本场异常" };
  if (input.phase === "post") return { key: input.isAdmin ? "post" : "none", label: input.isAdmin ? "完善赛后资料" : "" };
  if (input.isTeamRepresentative || input.isAdmin) {
    if (!input.scheduledAt && (input.phase === "preparing" || input.phase === "waiting_veto")) return { key: "schedule", label: "约定比赛时间" };
    if (!input.lineupsReady) return { key: "lineup", label: "选择本场首发" };
  }
  if ((input.isBpRepresentative || input.isAdmin) && ["preparing", "waiting_veto", "veto"].includes(input.phase)) return { key: "veto", label: "进入 BP 房间" };
  if (input.isAdmin && ["waiting_gameplay", "gameplay", "inter_map"].includes(input.phase)) return { key: "result", label: "录入本图结果" };
  return { key: "none", label: "" };
}
