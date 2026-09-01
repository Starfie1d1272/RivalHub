"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { acceptTeamInvitation, createTeam, createTeamShareInvitation, declineTeamInvitation, disbandTeam, inviteTeamMember, kickTeamMember, leaveTeam, revokeTeamInvitation, setTeamMembershipStatus, transferTeamCaptain, updateTeamProfile } from "@/actions/teams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";
import { TeamDangerZone } from "@/components/teams/TeamDangerZone";
import { TeamInvitationsSection } from "@/components/teams/TeamInvitationsSection";
import { TeamMembershipSection } from "@/components/teams/TeamMembershipSection";
import { TeamProfileSection } from "@/components/teams/TeamProfileSection";

type Membership = { id: string; userId: string; name: string; status: "active" | "benched" | "left" };
type Invitation = { id: string; teamId: string; teamName: string; email?: string | null; expiresAt: string };
type Team = { id: string; slug: string; name: string; logoUrl: string | null; description: string | null; recruiting: boolean; captainUserId: string };

export function LongLivedTeamWorkspace({ team, currentUserId, memberships, incomingInvitations, outgoingInvitations }: { team: Team | null; currentUserId: string; memberships: Membership[]; incomingInvitations: Invitation[]; outgoingInvitations: Invitation[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [recruiting, setRecruiting] = useState(team?.recruiting ?? false);
  const [email, setEmail] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);

  function run(work: () => Promise<{ success: boolean; error?: { message: string } }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.success) {
        toast.success(success);
        router.refresh();
      } else toast.error(result.error?.message ?? "操作失败");
    });
  }

  const invitations = <TeamInvitationsSection team={team} incoming={incomingInvitations} outgoing={outgoingInvitations} isCaptain={team?.captainUserId === currentUserId} pending={pending} email={email} shareLink={shareLink} onEmailChange={setEmail} onAccept={(invitationId) => run(() => acceptTeamInvitation({ invitationId }), "已加入队伍")} onDecline={(invitationId) => run(() => declineTeamInvitation({ invitationId }), "已拒绝邀请")} onInvite={() => team && run(async () => { const result = await inviteTeamMember({ teamId: team.id, email }); if (result.success) setEmail(""); return result; }, "邀请已发送")} onCreateShareLink={() => team && startTransition(async () => { const result = await createTeamShareInvitation({ teamId: team.id }); if (result.success) setShareLink(`${window.location.origin}/team-invites/${result.data.token}`); else toast.error(result.error.message); })} onRevoke={(invitationId) => team && run(() => revokeTeamInvitation({ teamId: team.id, invitationId }), "邀请已撤销")} />;

  if (!team) return <div className="space-y-5">{invitations}<div id="create-team" className="scroll-mt-24"><Panel label="创建队伍" pad={20}><div className="space-y-4"><StatusBanner tone="info" title="创建你的队伍" sub="创建后可以持续维护队伍资料和成员；参加具体赛事时再单独报名。" /><div className="space-y-1.5"><Label htmlFor="new-team-name">队伍名称</Label><Input id="new-team-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="new-team-description">简介</Label><Input id="new-team-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div><Button type="button" disabled={pending} onClick={() => run(() => createTeam({ name, description }), "队伍已创建")}>{pending ? "创建中…" : "创建队伍"}</Button></div></Panel></div></div>;

  const isCaptain = currentUserId === team.captainUserId;
  return <div className="space-y-5"><TeamProfileSection team={team} isCaptain={isCaptain} pending={pending} name={name} description={description} recruiting={recruiting} onNameChange={setName} onDescriptionChange={setDescription} onRecruitingChange={setRecruiting} onSave={() => run(() => updateTeamProfile({ teamId: team.id, name, description, recruiting }), "资料已保存")} onLeave={() => run(() => leaveTeam({ teamId: team.id }), "已退出队伍")} /><TeamMembershipSection captainUserId={team.captainUserId} memberships={memberships} isCaptain={isCaptain} pending={pending} onSetStatus={(userId, status) => run(() => setTeamMembershipStatus({ teamId: team.id, userId, status }), "成员状态已更新")} onTransferCaptain={(toUserId) => run(() => transferTeamCaptain({ teamId: team.id, toUserId }), "队长已交接")} onKick={(userId) => run(() => kickTeamMember({ teamId: team.id, userId }), "成员已移出")} />{invitations}{isCaptain && <TeamDangerZone pending={pending} onDisband={() => run(() => disbandTeam({ teamId: team.id }), "队伍已解散")} />}</div>;
}
