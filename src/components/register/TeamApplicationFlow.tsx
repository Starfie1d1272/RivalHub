"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  confirmTeamApplicationMembership,
  createTeamApplication,
  inviteTeamApplicationMember,
  removeTeamApplicationMember,
  submitTeamApplication,
  updateTeamApplication,
} from "@/actions/team-applications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";
import Link from "next/link";

type ApplicationStatus = "draft" | "submitted" | "approved" | "waitlisted" | "rejected";

export interface TeamApplicationMemberView {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  educationStatus: "unsubmitted" | "pending" | "approved" | "rejected";
  institutionName: string | null;
  status: "invited" | "confirmed";
}

export interface TeamApplicationView {
  id: string;
  name: string;
  logoUrl: string | null;
  captainUserId: string;
  status: ApplicationStatus;
  reviewReason: string | null;
}

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "待完善",
  submitted: "已提交审核",
  approved: "审核通过",
  waitlisted: "候补名单",
  rejected: "未通过，可修改后重提",
};
const EDUCATION_LABEL = { unsubmitted: "教育身份未提交", pending: "教育身份待审核", approved: "教育身份已认证", rejected: "教育身份被驳回" } as const;

interface Props {
  seasonId: string;
  seasonName: string;
  currentUserId: string;
  minTeamSize: number;
  maxTeamSize: number;
  application: TeamApplicationView | null;
  members: TeamApplicationMemberView[];
}

export function TeamApplicationFlow({
  seasonId,
  seasonName,
  currentUserId,
  minTeamSize,
  maxTeamSize,
  application,
  members,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [name, setName] = useState(application?.name ?? "");
  const [logoUrl, setLogoUrl] = useState(application?.logoUrl ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const isCaptain = application?.captainUserId === currentUserId;
  const ownMember = members.find((member) => member.userId === currentUserId);
  const editable = application?.status === "draft" || application?.status === "rejected";

  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, successMessage: string) => {
    startTransition(async () => {
      const result = await work();
      if (result.success) toast.success(successMessage);
      else toast.error(result.error?.message ?? "操作失败，请稍后重试");
    });
  };

  if (!application) {
    return (
      <Panel pad={24}>
        <div className="space-y-5">
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)] uppercase">TEAM APPLICATION</p>
            <h2 className="mt-1 text-xl font-semibold">创建报名队伍</h2>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">创建后邀请成员确认身份，再提交给赛事管理员审核。提交前不会生成正式队伍。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-name">队伍名称</Label>
            <Input id="team-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={32} placeholder="例如：NJU Rivals" />
          </div>
          <Button disabled={isPending || !newName.trim()} onClick={() => run(() => createTeamApplication({ seasonId, name: newName }), "报名队伍已创建")}>创建报名队伍</Button>
        </div>
      </Panel>
    );
  }

  if (!isCaptain) {
    const needsIdentity = !ownMember?.emailVerified || ownMember.educationStatus !== "approved";
    return (
      <Panel pad={24}>
        <StatusBanner
          tone={application.status === "approved" ? "success" : "info"}
          title={`${application.name} · ${STATUS_LABEL[application.status]}`}
          sub={ownMember?.status === "confirmed" ? "你的身份已确认，等待队长或管理员推进下一步。" : "队长已邀请你加入。确认后，你的账号会被记录在这支报名队伍中。"}
        />
        {ownMember?.status !== "confirmed" && editable && (
          <Button className="mt-4" disabled={isPending} onClick={() => run(() => confirmTeamApplicationMembership({ applicationId: application.id }), "身份已确认并加入报名队伍")}>确认身份并加入</Button>
        )}
        {needsIdentity && <div className="mt-4 space-y-2"><StatusBanner tone="warn" title="你还不能完成报名资格" sub="请先完成邮箱验证和教育身份认证。" /><Link className="inline-block text-sm underline" href="/settings/education">前往身份认证</Link></div>}
      </Panel>
    );
  }

  const confirmedCount = members.filter((member) => member.status === "confirmed").length;
  return (
    <div className="space-y-5">
      <StatusBanner
        tone={application.status === "approved" ? "success" : application.status === "rejected" ? "warn" : "info"}
        title={`${application.name} · ${STATUS_LABEL[application.status]}`}
        sub={application.reviewReason ?? (editable ? `确认 ${minTeamSize}-${maxTeamSize} 名成员后即可提交审核。` : "报名资料已锁定，等待管理员审核。")}
      />
      <Panel label="队伍资料" pad={24}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="application-name">队伍名称</Label><Input id="application-name" value={name} disabled={!editable} onChange={(event) => setName(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="application-logo">队标 URL（可选）</Label><Input id="application-logo" value={logoUrl} disabled={!editable} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://..." /></div>
        </div>
        {editable && <Button className="mt-4" variant="outline" disabled={isPending || !name.trim()} onClick={() => run(() => updateTeamApplication({ applicationId: application.id, name, logoUrl: logoUrl || null }), "队伍资料已保存")}>保存资料</Button>}
      </Panel>
      <Panel label={`确认名单 · ${confirmedCount}/${members.length}`} pad={24}>
        <div className="space-y-3">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{member.displayName || member.email}</p><p className="truncate text-xs text-[var(--color-fg-mid)]">{member.email}{member.userId === application.captainUserId ? " · 队长" : ""}</p><p className="truncate text-xs text-[var(--color-fg-mid)]">{member.emailVerified ? "邮箱已验证" : "邮箱未验证"} · {member.institutionName ?? "未声明学校"} · {EDUCATION_LABEL[member.educationStatus]}</p></div>
              <div className="flex shrink-0 items-center gap-2"><Badge variant="outline">{member.status === "confirmed" ? "已确认" : "待确认"}</Badge>{editable && member.userId !== application.captainUserId && <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => removeTeamApplicationMember({ applicationId: application.id, memberId: member.id }), "成员已移除")}>移除</Button>}</div>
            </div>
          ))}
        </div>
        {editable && <div className="mt-4 flex gap-2"><Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="已注册成员的邮箱" type="email" /><Button disabled={isPending || !inviteEmail.trim()} onClick={() => run(async () => { const result = await inviteTeamApplicationMember({ applicationId: application.id, email: inviteEmail }); if (result.success) setInviteEmail(""); return result; }, "邀请已发送，等待成员确认")}>邀请</Button></div>}
      </Panel>
      {(ownMember && (!ownMember.emailVerified || ownMember.educationStatus !== "approved")) && <StatusBanner tone="warn" title="你还不能完成报名资格" sub="请先完成邮箱验证和教育身份认证。" />}
      {ownMember && (!ownMember.emailVerified || ownMember.educationStatus !== "approved") && <Link className="inline-block text-sm underline" href="/settings/education">前往身份认证</Link>}
      {editable && <Button className="w-full" disabled={isPending || confirmedCount < minTeamSize || confirmedCount > maxTeamSize} onClick={() => run(() => submitTeamApplication({ applicationId: application.id }), `${seasonName} 报名已提交，等待审核`)}>提交审核</Button>}
    </div>
  );
}
