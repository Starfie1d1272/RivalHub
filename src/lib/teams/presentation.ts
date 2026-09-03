import type { StatusPresentation } from "@/lib/presentation";

const TEAM_STATUS_PRESENTATIONS: Record<"active" | "disbanded", StatusPresentation> = {
  active: { label: "活跃", tone: "success" },
  disbanded: { label: "已解散", tone: "neutral" },
};

const TEAM_MEMBERSHIP_PRESENTATIONS: Record<"active" | "benched" | "left", StatusPresentation> = {
  active: { label: "当前成员", tone: "success" },
  benched: { label: "替补成员", tone: "warn" },
  left: { label: "已退出", tone: "neutral" },
};

export function presentTeamStatus(status: "active" | "disbanded"): StatusPresentation {
  return TEAM_STATUS_PRESENTATIONS[status];
}

export function presentTeamMembershipStatus(status: "active" | "benched" | "left"): StatusPresentation {
  return TEAM_MEMBERSHIP_PRESENTATIONS[status];
}

export function getTeamDirectoryCta(currentTeam: boolean, pendingDirectInvitationCount: number): { href: string; label: string } {
  if (currentTeam) return { href: "/my/teams", label: "管理我的队伍" };
  if (pendingDirectInvitationCount > 0) return { href: "/my/teams", label: "处理队伍邀请" };
  return { href: "/my/teams#create-team", label: "创建队伍" };
}
