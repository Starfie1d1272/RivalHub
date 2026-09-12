"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createTeamShareInvitation, disbandTeam, inviteTeamMember, kickTeamMember, revokeTeamInvitation, setTeamMembershipStatus, transferTeamCaptain, updateTeamProfile } from "@/actions/teams";
import { TeamDangerZone } from "@/components/teams/TeamDangerZone";
import { TeamInvitationsSection } from "@/components/teams/TeamInvitationsSection";
import { TeamMembershipSection } from "@/components/teams/TeamMembershipSection";
import { TeamProfileSection } from "@/components/teams/TeamProfileSection";
import { TeamRecruitmentSection } from "@/components/recruitment/TeamRecruitmentSection";
import type { Cs2Position } from "@/lib/config/cs2-positions";

type Membership = { id: string; userId: string; name: string; status: "active" | "benched" | "left" };
type Invitation = { id: string; teamId: string; teamName: string; email?: string | null; expiresAt: string };
type GeneratedShareLink = { url: string; expiresAt: string };
type Team = { id: string; slug: string; name: string; logoUrl: string | null; description: string | null; captainUserId: string };
type Recruitment = { id: string; positions: Cs2Position[]; targetSeasonId: string | null; targetSeasonName: string | null; note: string | null; status: "open" | "closed"; expiresAt: string; isPubliclyActive: boolean } | null;

export function LongLivedTeamWorkspace({ team, memberships, incomingInvitations, outgoingInvitations, recruitment, targetSeasons, recruitmentInterests }: { team: Team; memberships: Membership[]; incomingInvitations: Invitation[]; outgoingInvitations: Invitation[]; recruitment: Recruitment; targetSeasons: Array<{ id: string; name: string }>; recruitmentInterests: Array<{ userId: string; name: string; positions: Cs2Position[] }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [email, setEmail] = useState("");
  const [shareLink, setShareLink] = useState<GeneratedShareLink | null>(null);

  function run(work: () => Promise<{ success: boolean; error?: { message: string } }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.success) {
        toast.success(success);
        router.refresh();
      } else toast.error(result.error?.message ?? "操作失败");
    });
  }

  const invitations = <TeamInvitationsSection team={team} incoming={incomingInvitations} outgoing={outgoingInvitations} isCaptain pending={pending} email={email} shareLink={shareLink} onEmailChange={setEmail} onAccept={() => undefined} onDecline={() => undefined} onInvite={() => run(async () => { const result = await inviteTeamMember({ teamId: team.id, email }); if (result.success) setEmail(""); return result; }, "邀请已发送")} onCreateShareLink={() => startTransition(async () => { const result = await createTeamShareInvitation({ teamId: team.id }); if (result.success) setShareLink({ url: `${window.location.origin}/team-invites/${result.data.token}`, expiresAt: result.data.expiresAt }); else toast.error(result.error.message); })} onRevoke={(invitationId) => run(() => revokeTeamInvitation({ teamId: team.id, invitationId }), "邀请已撤销")} />;

  return <div className="space-y-5"><TeamProfileSection team={team} pending={pending} name={name} description={description} onNameChange={setName} onDescriptionChange={setDescription} onSave={() => run(() => updateTeamProfile({ teamId: team.id, name, description }), "资料已保存")} /><TeamRecruitmentSection team={team} isCaptain recruitment={recruitment} targetSeasons={targetSeasons} interests={recruitmentInterests} /><TeamMembershipSection captainUserId={team.captainUserId} memberships={memberships} isCaptain pending={pending} onSetStatus={(userId, status) => run(() => setTeamMembershipStatus({ teamId: team.id, userId, status }), "成员状态已更新")} onTransferCaptain={(toUserId) => run(() => transferTeamCaptain({ teamId: team.id, toUserId }), "队长已交接")} onKick={(userId) => run(() => kickTeamMember({ teamId: team.id, userId }), "成员已移出")} />{invitations}<TeamDangerZone pending={pending} onDisband={() => run(() => disbandTeam({ teamId: team.id }), "队伍已解散")} /></div>;
}
