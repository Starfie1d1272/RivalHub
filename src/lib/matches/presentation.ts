import type { StatusPresentation } from "@/lib/presentation";
import type { MatchFormat, MatchStatus } from "@/types/match";

const MATCH_STATUS_PRESENTATIONS: Record<MatchStatus, StatusPresentation> = {
  scheduled: { label: "待进行", tone: "neutral" },
  in_progress: { label: "LIVE", tone: "info" },
  finished: { label: "FT", tone: "success" },
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

export function presentMatchFormat(format: MatchFormat): StatusPresentation {
  return MATCH_FORMAT_PRESENTATIONS[format];
}
