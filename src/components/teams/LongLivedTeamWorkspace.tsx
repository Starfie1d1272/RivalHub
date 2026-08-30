"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  acceptTeamInvitation,
  createTeam,
  createTeamShareInvitation,
  declineTeamInvitation,
  disbandTeam,
  inviteTeamMember,
  kickTeamMember,
  leaveTeam,
  revokeTeamInvitation,
  setTeamMembershipStatus,
  transferTeamCaptain,
  updateTeamProfile,
} from "@/actions/teams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Membership = { id: string; userId: string; name: string; status: "active" | "benched" | "left"; role: "captain" | "member" };
type Invitation = { id: string; teamId: string; teamName: string; email?: string | null; expiresAt: string };

export function LongLivedTeamWorkspace({
  team,
  currentUserId,
  memberships,
  incomingInvitations,
  outgoingInvitations,
}: {
  team: { id: string; slug: string; name: string; description: string | null; recruiting: boolean; captainUserId: string } | null;
  currentUserId: string;
  memberships: Membership[];
  incomingInvitations: Invitation[];
  outgoingInvitations: Invitation[];
}) {
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

  if (!team) return <div className="space-y-5">
    {incomingInvitations.length > 0 && <Panel label="待处理邀请" pad={20}><div className="space-y-3">{incomingInvitations.map((invite) => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3"><div><p className="font-medium">{invite.teamName}</p><p className="text-xs text-[var(--color-fg-mid)]">有效期至 {new Date(invite.expiresAt).toLocaleString("zh-CN")}</p></div><div className="flex gap-2"><Button disabled={pending} onClick={() => run(() => acceptTeamInvitation({ invitationId: invite.id }), "已加入队伍")}>接受</Button><Button variant="outline" disabled={pending} onClick={() => run(() => declineTeamInvitation({ invitationId: invite.id }), "已拒绝邀请")}>拒绝</Button></div></div>)}</div></Panel>}
    <Panel label="创建队伍" pad={20}><div className="space-y-4"><StatusBanner tone="info" title="建立你的长期队伍" sub="队伍可持续维护成员、资料和招募状态；参加每届赛事时再单独报名。" /><div className="space-y-1.5"><Label>队伍名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-1.5"><Label>简介</Label><Input value={description} onChange={(event) => setDescription(event.target.value)} /></div><Button disabled={pending} onClick={() => run(() => createTeam({ name, description }), "队伍已创建")}>{pending ? "创建中…" : "创建队伍"}</Button></div></Panel>
  </div>;

  const isCaptain = currentUserId === team.captainUserId;
  return <div className="space-y-5">
    <Panel label="队伍资料" pad={20}><div className="space-y-4"><div className="space-y-1.5"><Label>队伍名称</Label><Input value={name} disabled={!isCaptain} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-1.5"><Label>简介</Label><Input value={description} disabled={!isCaptain} onChange={(event) => setDescription(event.target.value)} /></div>{isCaptain && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={recruiting} onChange={(event) => setRecruiting(event.target.checked)} />公开招募中</label>}{isCaptain ? <Button disabled={pending} onClick={() => run(() => updateTeamProfile({ teamId: team.id, name, description, recruiting }), "资料已保存")}>保存资料</Button> : <Button variant="outline" disabled={pending} onClick={() => run(() => leaveTeam({ teamId: team.id }), "已退出队伍")}>退出队伍</Button>}</div></Panel>

    <Panel label="当前成员" pad={20}><div className="space-y-3">{memberships.map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3"><div><p className="font-medium">{member.name}{member.role === "captain" ? " · 队长" : ""}</p><p className="font-mono text-[11px] text-[var(--color-fg-mid)]">{member.status === "active" ? "ACTIVE" : "BENCHED"}</p></div>{isCaptain && member.role !== "captain" && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending} onClick={() => run(() => setTeamMembershipStatus({ teamId: team.id, userId: member.userId, status: member.status === "active" ? "benched" : "active" }), "成员状态已更新")}>{member.status === "active" ? "设为替补" : "恢复 active"}</Button>{member.status === "active" && <Button variant="outline" disabled={pending} onClick={() => run(() => transferTeamCaptain({ teamId: team.id, toUserId: member.userId }), "队长已交接")}>交接队长</Button>}<Button variant="outline" disabled={pending} onClick={() => run(() => kickTeamMember({ teamId: team.id, userId: member.userId }), "成员已移出")}>移出</Button></div>}</div>)}</div></Panel>

    {isCaptain && <Panel label="邀请成员" pad={20}><div className="space-y-4"><div className="flex gap-2"><Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="已注册邮箱" /><Button disabled={pending || !email} onClick={() => run(async () => { const result = await inviteTeamMember({ teamId: team.id, email }); if (result.success) setEmail(""); return result; }, "邀请已发送")}>直接邀请</Button></div><Button variant="outline" disabled={pending} onClick={() => startTransition(async () => { const result = await createTeamShareInvitation({ teamId: team.id }); if (result.success) setShareLink(`${window.location.origin}/team-invites/${result.data.token}`); else toast.error(result.error.message); })}>生成分享邀请链接</Button>{shareLink && <Input readOnly value={shareLink} onFocus={(event) => event.currentTarget.select()} />}{outgoingInvitations.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-3 text-sm"><span>{invite.email ?? "分享链接"} · 待处理</span><Button variant="outline" disabled={pending} onClick={() => run(() => revokeTeamInvitation({ teamId: team.id, invitationId: invite.id }), "邀请已撤销")}>撤销</Button></div>)}</div></Panel>}

    {isCaptain && <Panel label="解散队伍" pad={20}><div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-[var(--color-fg-mid)]">有正在进行的赛事时暂不能解散。已结束赛事的记录会保留。</p><Button variant="outline" disabled={pending} onClick={() => { if (window.confirm("确定解散这支长期队伍？已结束赛事的记录会保留。")) run(() => disbandTeam({ teamId: team.id }), "队伍已解散"); }}>解散队伍</Button></div></Panel>}
  </div>;
}
