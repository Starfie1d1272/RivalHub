"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { acceptTeamInvitation, createTeam, declineTeamInvitation } from "@/actions/teams";
import { TeamInvitationsSection } from "@/components/teams/TeamInvitationsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Invitation = { id: string; teamId: string; teamName: string; expiresAt: string };

export function NoTeamWorkspace({ pendingInvitations }: { pendingInvitations: Invitation[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function run(work: () => Promise<{ success: boolean; error?: { message: string } }>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.success) {
        toast.success(success);
        router.refresh();
      } else toast.error(result.error?.message ?? "操作失败");
    });
  }

  return <div className="space-y-5">
    <TeamInvitationsSection team={null} incoming={pendingInvitations} outgoing={[]} isCaptain={false} pending={pending} email="" shareLink={null} onEmailChange={() => undefined} onAccept={(invitationId) => run(() => acceptTeamInvitation({ invitationId }), "已加入队伍")} onDecline={(invitationId) => run(() => declineTeamInvitation({ invitationId }), "已拒绝邀请")} onInvite={() => undefined} onCreateShareLink={() => undefined} onRevoke={() => undefined} />
    <div id="create-team" className="scroll-mt-24"><Panel label="创建队伍" contentClassName="p-5"><div className="space-y-4"><StatusBanner tone="info" title="创建你的队伍" sub="创建后可以持续维护队伍资料和成员；参加具体赛事时再单独报名。" /><div className="space-y-1.5"><Label htmlFor="new-team-name">队伍名称</Label><Input id="new-team-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="new-team-description">简介</Label><Input id="new-team-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={() => run(() => createTeam({ name, description }), "队伍已创建")}>{pending ? "创建中…" : "创建队伍"}</Button><Button type="button" variant="outline" asChild><Link href="/teams/recruitment?view=teams">去组队大厅</Link></Button></div></div></Panel></div>
  </div>;
}
