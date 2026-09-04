import type { StatusPresentation } from "@/lib/presentation";
import type { Team, TeamInvitation } from "@/db/schema";

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

type TeamShareInvitationState = "available" | "accepted" | "revoked" | "expired" | "disbanded" | "unavailable";

interface TeamShareInvitationPresentation {
  state: TeamShareInvitationState;
  title: string;
  sub: string;
  canAccept: boolean;
}

type TeamShareInvitationStateInput = Pick<TeamInvitation, "status" | "expiresAt"> & { teamStatus: Team["status"] };

export function presentTeamShareInvitation(
  invitation: TeamShareInvitationStateInput,
  now = new Date(),
): TeamShareInvitationPresentation {
  if (invitation.teamStatus === "disbanded") {
    return { state: "disbanded", title: "队伍已解散", sub: "这支队伍已解散，这个邀请已失效。", canAccept: false };
  }
  if (invitation.teamStatus !== "active") {
    return { state: "unavailable", title: "邀请已失效", sub: "这个邀请链接当前不可用。", canAccept: false };
  }
  if (invitation.status === "accepted") {
    return { state: "accepted", title: "邀请已被使用", sub: "这个邀请链接已经被使用，无法再次加入队伍。", canAccept: false };
  }
  if (invitation.status === "revoked") {
    return { state: "revoked", title: "邀请已撤销", sub: "这个邀请已被队长撤销。", canAccept: false };
  }
  if (invitation.status === "expired" || invitation.expiresAt.getTime() <= now.getTime()) {
    return { state: "expired", title: "邀请链接已过期", sub: "这个邀请链接已过期。", canAccept: false };
  }
  if (invitation.status === "pending") {
    return { state: "available", title: "这是队伍邀请", sub: "接受邀请即加入队伍；加入队伍不等于参加任何赛事，参赛时仍需在对应赛事中确认名单。", canAccept: true };
  }
  return { state: "unavailable", title: "邀请已失效", sub: "这个邀请链接当前不可用。", canAccept: false };
}

export function getTeamDirectoryCta(currentTeam: boolean, pendingDirectInvitationCount: number): { href: string; label: string } {
  if (currentTeam) return { href: "/my/teams", label: "管理我的队伍" };
  if (pendingDirectInvitationCount > 0) return { href: "/my/teams", label: "处理队伍邀请" };
  return { href: "/my/teams#create-team", label: "创建队伍" };
}
