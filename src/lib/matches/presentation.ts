import type { StatusPresentation } from "@/lib/presentation";
import type { MatchFormat, MatchStatus } from "@/types/match";
import { isHttpUrl } from "@/lib/external-url";

import type { StagePlan } from "@/types/season";
import { MATCH_STAGE_LABELS } from "@/types/match";
import type { projectMatchScheduling } from "./time-rules";
import { formatCST } from "@/lib/utils/date";

export function presentMatchStage(stage: string, stagePlan?: StagePlan | null): string {
  return stage === "play-in" ? "PLAY-IN" : stagePlan?.find(item => item.key === stage)?.name ?? MATCH_STAGE_LABELS[stage] ?? "比赛阶段";
}

export function presentSchedulingAction(state: ReturnType<typeof projectMatchScheduling>["state"], pendingIsMine = false): string {
  switch (state) {
    case "unproposed": return "发起比赛时间提议";
    case "pending": return pendingIsMine ? "等待对方回应" : "确认比赛时间";
    case "reschedule_pending": return pendingIsMine ? "改期待对方回应" : "回应改期提议";
    case "confirmed": return "赛前准备";
    case "inactive": return "查看比赛";
  }
}


const MATCH_STATUS_PRESENTATIONS: Record<MatchStatus, StatusPresentation> = {
  scheduled: { label: "待进行", tone: "neutral" },
  in_progress: { label: "进行中", tone: "accent" },
  finished: { label: "已结束", tone: "success" },
  cancelled: { label: "已取消", tone: "danger" },
};

const MATCH_FORMAT_PRESENTATIONS: Record<MatchFormat, StatusPresentation> = {
  bo1: { label: "BO1", tone: "neutral" },
  bo3: { label: "BO3", tone: "neutral" },
  bo5: { label: "BO5", tone: "neutral" },
};

export function presentMatchStatus(status: MatchStatus, options?: { isForfeit?: boolean; scheduledAt?: Date | string | null }): StatusPresentation {
  if (status === "finished" && options?.isForfeit) return { label: "弃赛", tone: "danger" };
  if (status === "scheduled" && !options?.scheduledAt) return { label: "待排期", tone: "neutral" };
  return MATCH_STATUS_PRESENTATIONS[status];
}

export interface PersonalMatchTask {
  title: string;
  detail: string;
  href: string;
}

export function presentPersonalMatchTask(input: {
  matchId: string;
  seasonSlug: string;
  opponentName: string;
  scheduledAt: Date | null;
  status?: "scheduled" | "in_progress";
  scheduling?: ReturnType<typeof projectMatchScheduling>;
  isRepresentative?: boolean;
  pendingIsMine?: boolean;
}): PersonalMatchTask {
  const scheduling = input.scheduling;
  const scheduleDetail = scheduling?.state === "reschedule_pending" ? "改期待回应" :
    input.scheduledAt ? formatCST(input.scheduledAt) : presentMatchStatus(input.status ?? "scheduled", { scheduledAt: input.scheduledAt }).label;
  return {
    title: input.status === "in_progress" ? "你的当前比赛" : input.isRepresentative && scheduling ? presentSchedulingAction(scheduling.state, input.pendingIsMine) : "你的下一场",
    detail: `对阵 ${input.opponentName} · ${scheduling ? [scheduling.state === "reschedule_pending" && input.scheduledAt ? formatCST(input.scheduledAt) : null, scheduleDetail].filter(Boolean).join(" · ") : presentMatchStatus(input.status ?? "scheduled", { scheduledAt: input.scheduledAt }).label}`,
    href: `/${input.seasonSlug}/matches/${input.matchId}${input.isRepresentative && input.status !== "in_progress" ? "?scheduling=1" : ""}`,
  };
}

export function presentMatchFormat(format: MatchFormat): StatusPresentation {
  return MATCH_FORMAT_PRESENTATIONS[format];
}

export function presentMatchLabel(input: { stage: string; round?: number | null; entryRound?: string | null; teamAName: string; teamBName: string; stageName?: string | null }): string {
  const phase = input.round != null ? `第 ${input.round} 轮` : input.entryRound ?? null;
  return [input.stageName ?? input.stage, phase, `${input.teamAName} vs ${input.teamBName}`].filter(Boolean).join(" · ");
}

export function getPublicLiveCommentators<T extends { liveStreamUrl: string | null }>(
  status: "scheduled" | "in_progress" | "finished" | "cancelled",
  commentators: T[],
): T[] {
  return status === "scheduled" || status === "in_progress"
    ? commentators.filter(
        (commentator) => commentator.liveStreamUrl !== null && isHttpUrl(commentator.liveStreamUrl),
      )
    : [];
}
