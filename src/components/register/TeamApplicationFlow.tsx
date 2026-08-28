"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmTeamApplicationMembership, createTeamApplication, inviteTeamApplicationMember, removeTeamApplicationMember, submitTeamApplication, updateTeamApplication } from "@/actions/team-applications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checklist, Panel, StatusBanner } from "@/components/rivalhub";

type ApplicationStatus = "draft" | "submitted" | "approved" | "waitlisted" | "rejected";
export interface TeamApplicationMemberView { id: string; userId: string; email: string; displayName: string | null; emailVerified: boolean; educationStatus: "unsubmitted" | "pending" | "approved" | "rejected"; institutionName: string | null; status: "invited" | "confirmed"; readinessBlockers: string[]; }
export interface TeamApplicationView { id: string; name: string; logoUrl: string | null; perfectTeamId: string | null; primaryStarterUserIds: string[]; captainUserId: string; status: ApplicationStatus; reviewReason: string | null; }
const STATUS_LABEL: Record<ApplicationStatus, string> = { draft: "待完善", submitted: "已提交审核", approved: "审核通过", waitlisted: "候补名单", rejected: "未通过，可修改后重提" };
const EDUCATION_LABEL = { unsubmitted: "未提交", pending: "审核中", approved: "已认证", rejected: "已驳回" } as const;
interface Props { seasonId: string; seasonName: string; currentUserId: string; minTeamSize: number; maxTeamSize: number; application: TeamApplicationView | null; members: TeamApplicationMemberView[]; qualification?: { njuPrimaryCount: number; externalStrengthBlockers: string[] }; }

function MemberRow({ member, captainUserId, editable, isPending, selected, canSelect, onSelect, onRemove }: { member: TeamApplicationMemberView; captainUserId: string; editable: boolean; isPending: boolean; selected?: boolean; canSelect?: boolean; onSelect?: () => void; onRemove?: () => void }) {
  const ready = member.status === "confirmed" && member.readinessBlockers.length === 0;
  return <div className="grid gap-3 border border-[var(--color-border)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-2"><p className="break-all text-sm font-medium">{member.displayName || member.email}</p>{member.userId === captainUserId && <Badge variant="outline">队长</Badge>}<Badge variant="outline">{member.status === "confirmed" ? "已确认" : "待确认"}</Badge></div>
      <p className="break-all font-mono text-[11px] text-[var(--color-fg-mid)]">{member.email}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--color-fg-mid)]"><span>{member.emailVerified ? "邮箱已验证" : "邮箱未验证"}</span><span>{member.institutionName ?? "未声明学校"} · {EDUCATION_LABEL[member.educationStatus]}</span><span style={{ color: ready ? "var(--color-ok)" : "var(--color-warn)" }}>{ready ? "资料齐全" : "需完善资料"}</span></div>
      {member.readinessBlockers.length > 0 && <p className="pt-1 text-xs leading-5 text-[var(--color-warn)]">{member.readinessBlockers.join(" ")}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-2">{onSelect && <label className="flex items-center gap-2 text-xs"><Checkbox checked={selected} disabled={!editable || isPending || (!selected && !canSelect)} onChange={onSelect} />预定主力</label>}{editable && member.userId !== captainUserId && onRemove && <Button size="sm" variant="ghost" disabled={isPending} onClick={onRemove}>移除</Button>}</div>
  </div>;
}

export function TeamApplicationFlow({ seasonId, seasonName, currentUserId, minTeamSize, maxTeamSize, application, members, qualification }: Props) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState(""); const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [name, setName] = useState(application?.name ?? ""); const [logoUrl, setLogoUrl] = useState(application?.logoUrl ?? ""); const [perfectTeamId, setPerfectTeamId] = useState(application?.perfectTeamId ?? ""); const [primaryStarterUserIds, setPrimaryStarterUserIds] = useState<string[]>(application?.primaryStarterUserIds ?? []); const [inviteEmail, setInviteEmail] = useState("");
  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, successMessage: string) => startTransition(async () => { const result = await work(); if (result.success) toast.success(successMessage); else toast.error(result.error?.message ?? "操作失败，请稍后重试"); });

  if (!application) return <Panel pad={24}><div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">TEAM APPLICATION</p><h2 className="mt-1 text-xl font-semibold">创建报名队伍</h2><p className="mt-1 text-sm leading-6 text-[var(--color-fg-mid)]">先建立队伍资料，再邀请成员完善资料并确认加入。提交审核前不会生成正式队伍。</p></div><div className="space-y-2"><Label htmlFor="team-name">队伍名称</Label><Input id="team-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={32} placeholder="例如：NJU Rivals" /></div><label className="flex items-start gap-2 text-xs leading-5 text-[var(--color-fg-mid)]"><Checkbox checked={privacyAcknowledged} onChange={(event) => setPrivacyAcknowledged(event.target.checked)} />我已阅读赛事规则与 <Link className="underline" href="/privacy">隐私与数据使用说明</Link>。</label><Button disabled={isPending || !newName.trim() || !privacyAcknowledged} onClick={() => run(() => createTeamApplication({ seasonId, name: newName, privacyAcknowledged }), "报名队伍已创建")}>创建报名队伍</Button></div></Panel>;

  const isCaptain = application.captainUserId === currentUserId; const ownMember = members.find((member) => member.userId === currentUserId); const editable = application.status === "draft" || application.status === "rejected";
  if (!isCaptain) {
    const missing = ownMember?.readinessBlockers ?? [];
    return <Panel pad={24}><div className="space-y-4"><StatusBanner tone={application.status === "approved" ? "success" : "info"} title={`${application.name} · ${STATUS_LABEL[application.status]}`} sub={ownMember?.status === "confirmed" ? "你的身份已确认，等待队长或管理员推进下一步。" : "队长已邀请你加入。先补齐个人资料，再确认加入。"} />
      {missing.length > 0 && <><Panel label="确认加入前需完成" pad={0}><Checklist items={missing.map((label) => ({ label, state: "blocked" as const, href: label.includes("高校") ? "/settings/education" : label.includes("竞技") || label.includes("段位") || label.includes("Rating") ? "/settings/competitive" : "/settings" }))} /></Panel><Button asChild variant="outline"><Link href="/settings">完善参赛资料</Link></Button></>}
      {ownMember?.status !== "confirmed" && editable && <><label className="flex items-start gap-2 text-xs leading-5 text-[var(--color-fg-mid)]"><Checkbox checked={privacyAcknowledged} onChange={(event) => setPrivacyAcknowledged(event.target.checked)} />我已阅读赛事规则与 <Link className="underline" href="/privacy">隐私与数据使用说明</Link>。</label><Button disabled={isPending || !privacyAcknowledged || missing.length > 0} onClick={() => run(() => confirmTeamApplicationMembership({ applicationId: application.id, privacyAcknowledged }), "身份已确认并加入报名队伍")}>确认身份并加入</Button></>}</div></Panel>;
  }

  const confirmed = members.filter((member) => member.status === "confirmed"); const confirmedCount = confirmed.length;
  const teamBlockers = [
    { label: `队伍人数 ${confirmedCount}/${minTeamSize}–${maxTeamSize}`, state: confirmedCount >= minTeamSize && confirmedCount <= maxTeamSize ? "complete" as const : "blocked" as const, detail: "所有队员都需确认加入。" },
    { label: `完美战队 ID${perfectTeamId.trim() ? "已填写" : "未填写"}`, state: perfectTeamId.trim() ? "complete" as const : "blocked" as const, detail: "供报名审核与完美平台赛事房间核对使用。" },
    { label: `预定主力 ${primaryStarterUserIds.length}/5`, state: primaryStarterUserIds.length === 5 ? "complete" as const : "blocked" as const, detail: "只用于报名审核、实力检查与种子参考。" },
    { label: `成员资料 ${confirmed.filter((member) => member.readinessBlockers.length === 0).length}/${confirmedCount} 齐全`, state: confirmed.length > 0 && confirmed.every((member) => member.readinessBlockers.length === 0) ? "complete" as const : "blocked" as const, detail: "提交时服务器将再次检查教育认证与竞技档案。" },
    { label: `预定主力 NJU 成员 ${qualification?.njuPrimaryCount ?? 0}/3`, state: (qualification?.njuPrimaryCount ?? 0) >= 3 ? "complete" as const : "blocked" as const, detail: "正式名单与每场首发的 NJU 要求均会由服务器复核。" },
    { label: qualification?.externalStrengthBlockers.length ? "外校成员实力限制未通过" : "外校成员实力限制通过", state: qualification?.externalStrengthBlockers.length ? "blocked" as const : "complete" as const, detail: qualification?.externalStrengthBlockers.join(" ") ?? "以五名预定主力作报名审核参考。" },
  ];
  const submitReady = teamBlockers.every((item) => item.state === "complete");
  return <div className="space-y-5"><StatusBanner tone={application.status === "approved" ? "success" : application.status === "rejected" ? "warn" : "info"} title={`${application.name} · ${STATUS_LABEL[application.status]}`} sub={application.reviewReason ?? (editable ? "按顺序完善下列报名检查后提交审核。" : "报名资料已锁定，等待管理员审核。")} />
    <Panel label="1 · 队伍资料" pad={24}><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="application-name">队伍名称</Label><Input id="application-name" value={name} disabled={!editable} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="application-logo">队标 URL（可选）</Label><Input id="application-logo" value={logoUrl} disabled={!editable} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://..." /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="perfect-team-id">完美战队 ID</Label><Input id="perfect-team-id" value={perfectTeamId} disabled={!editable} onChange={(event) => setPerfectTeamId(event.target.value)} placeholder="报名审核与完美平台赛事房间核对使用" /></div></div>{editable && <Button className="mt-4" variant="outline" disabled={isPending || !name.trim()} onClick={() => run(() => updateTeamApplication({ applicationId: application.id, name, logoUrl: logoUrl || null, perfectTeamId, primaryStarterUserIds }), "队伍资料已保存")}>保存队伍资料</Button>}</Panel>
    <Panel label={`2 · 成员邀请与确认 · ${confirmedCount}/${members.length}`} pad={24}><div className="space-y-3">{members.map((member) => <MemberRow key={member.id} member={member} captainUserId={application.captainUserId} editable={editable} isPending={isPending} onRemove={() => run(() => removeTeamApplicationMember({ applicationId: application.id, memberId: member.id }), "成员已移除")} />)}</div>{editable && <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="已注册成员的邮箱" type="email" /><Button disabled={isPending || !inviteEmail.trim()} onClick={() => run(async () => { const result = await inviteTeamApplicationMember({ applicationId: application.id, email: inviteEmail }); if (result.success) setInviteEmail(""); return result; }, "邀请已发送，等待成员确认")}>邀请成员</Button></div>}</Panel>
    <Panel label={`3 · 预定主力 · ${primaryStarterUserIds.length}/5`} pad={24}><p className="mb-4 text-sm leading-6 text-[var(--color-fg-mid)]">预定主力用于报名审核、外校成员实力检查和管理员种子参考；不替代每场比赛的正式首发。</p><div className="space-y-2">{confirmed.map((member) => <MemberRow key={member.id} member={member} captainUserId={application.captainUserId} editable={editable} isPending={isPending} selected={primaryStarterUserIds.includes(member.userId)} canSelect={primaryStarterUserIds.length < 5} onSelect={() => setPrimaryStarterUserIds((current) => current.includes(member.userId) ? current.filter((id) => id !== member.userId) : [...current, member.userId])} />)}</div>{editable && <Button className="mt-4" variant="outline" disabled={isPending} onClick={() => run(() => updateTeamApplication({ applicationId: application.id, name, logoUrl: logoUrl || null, perfectTeamId, primaryStarterUserIds }), "预定主力已保存")}>保存预定主力</Button>}</Panel>
    <Panel label="4 · 报名检查" pad={0}><Checklist items={teamBlockers} /><div className="space-y-3 border-t border-[var(--color-border)] p-4"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">外校成员实力与教育认证会在提交时用服务器中的最新资料复核；管理员可在审核页看到可解释的结果。</p>{editable && <Button className="w-full sm:w-auto" disabled={isPending || !submitReady} onClick={() => run(() => submitTeamApplication({ applicationId: application.id }), `${seasonName} 报名已提交，等待审核`)}>{submitReady ? "提交审核" : "完成报名检查后可提交"}</Button>}</div></Panel>
  </div>;
}
