"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { reviewTeamApplication } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checklist, Panel, StatusBanner } from "@/components/rivalhub";

type ReviewState = "complete" | "blocked" | "pending";
export interface TeamApplicationReviewRow {
  id: string; name: string; status: "draft" | "submitted" | "approved" | "waitlisted" | "rejected"; captainEmail: string; perfectTeamId: string | null; primaryStarterUserIds: string[]; reviewReason: string | null;
  members: Array<{ userId: string; email: string; displayName: string | null; perfectId: string | null; emailVerified: boolean; educationStatus: "unsubmitted" | "pending" | "approved" | "rejected"; institutionName: string | null; institutionCode: string | null; status: "invited" | "confirmed"; readinessBlockers: string[]; disciplineBlocked: boolean; strength: { summary: string; blockers: string[] } | null; isNju: boolean }>;
  qualification: { education: { state: ReviewState; detail: string }; readiness: { state: ReviewState; detail: string }; externalStrength: { state: ReviewState; detail: string }; discipline: { state: ReviewState; detail: string } };
}
const LABEL = { draft: "待完善", submitted: "待审核", approved: "已通过", waitlisted: "候补", rejected: "已拒绝" } as const;
const EDUCATION = { unsubmitted: "未提交", pending: "审核中", approved: "已认证", rejected: "已驳回" } as const;

export function TeamApplicationReviewList({ applications }: { applications: TeamApplicationReviewRow[] }) {
  const [isPending, startTransition] = useTransition();
  const review = (applicationId: string, status: "approved" | "waitlisted" | "rejected") => startTransition(async () => { const result = await reviewTeamApplication({ applicationId, status }); if (!result.success) toast.error(result.error.message); else toast.success(status === "approved" ? "已通过并生成正式队伍" : `报名队伍已${LABEL[status]}`); });
  if (applications.length === 0) return <StatusBanner tone="info" title="暂无队伍报名" sub="新的队伍报名提交后会显示在这里。" />;
  return <div className="space-y-5">{applications.map((application) => {
    const confirmed = application.members.filter((member) => member.status === "confirmed"); const starters = application.members.filter((member) => application.primaryStarterUserIds.includes(member.userId));
    const unresolved = Object.values(application.qualification).filter((item) => item.state !== "complete");
    return <Panel key={application.id} label={`报名审核 · ${application.name}`} pad={0}><div className="space-y-5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{application.name}</h3><Badge variant="outline">{LABEL[application.status]}</Badge></div><p className="mt-2 break-all font-mono text-[11px] text-[var(--color-fg-mid)]">队长：{application.captainEmail} · 完美战队 ID：{application.perfectTeamId ?? "未填写"}</p></div>{(application.status === "submitted" || application.status === "waitlisted") && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={isPending} onClick={() => review(application.id, "approved")}>通过报名</Button><Button size="sm" variant="outline" disabled={isPending} onClick={() => review(application.id, "waitlisted")}>候补</Button><Button size="sm" variant="destructive" disabled={isPending} onClick={() => review(application.id, "rejected")}>拒绝</Button></div>}</div>
      {application.reviewReason && <StatusBanner tone="warn" title="上次审核说明" sub={application.reviewReason} />}
      {unresolved.length > 0 && <StatusBanner tone="warn" title={`${unresolved.length} 项资格仍需处理`} sub="以下状态来自当前报名资料；通过前会再次核验资格。" />}
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]"><section className="space-y-2"><h4 className="font-mono text-[11px] tracking-[0.14em] text-[var(--color-fg-mid)]">资格摘要</h4><Checklist items={[{ label: application.qualification.readiness.detail, state: application.qualification.readiness.state }, { label: application.qualification.education.detail, state: application.qualification.education.state }, { label: application.qualification.externalStrength.detail, state: application.qualification.externalStrength.state }, { label: application.qualification.discipline.detail, state: application.qualification.discipline.state }]} /></section><section className="space-y-2"><h4 className="font-mono text-[11px] tracking-[0.14em] text-[var(--color-fg-mid)]">预定主力与种子参考</h4><Checklist items={[{ label: `预定主力 ${starters.length}/5`, state: starters.length === 5 ? "complete" : "blocked", detail: "用于报名审核和种子参考；比赛前仍需提交当场首发。" }, ...starters.map((member) => ({ label: member.displayName ?? member.email, state: member.strength?.blockers.length ? "blocked" as const : "complete" as const, detail: member.strength?.blockers.length ? member.strength.blockers.join(" ") : member.strength?.summary ?? "竞技资料尚未载入。" })), { label: "最终种子", state: "pending", detail: "最终 1–32 种子将在赛前由管理员确认并锁定。" }]} /></section></div>
      <section className="space-y-2"><h4 className="font-mono text-[11px] tracking-[0.14em] text-[var(--color-fg-mid)]">报名名单 · 已确认 {confirmed.length}/{application.members.length}</h4><div className="grid gap-2 lg:grid-cols-2">{application.members.map((member) => <div key={member.userId} className="border border-[var(--color-border)] p-3"><div className="flex flex-wrap items-center gap-2"><p className="break-all text-sm font-medium">{member.displayName ?? member.email}</p><Badge variant="outline">{member.status === "confirmed" ? "已确认" : "待确认"}</Badge>{application.primaryStarterUserIds.includes(member.userId) && <Badge variant="outline">预定主力</Badge>}</div><p className="mt-1 break-all font-mono text-[11px] text-[var(--color-fg-mid)]">{member.email} · Perfect ID：{member.perfectId ?? "未填写"}</p><p className="mt-1 text-xs text-[var(--color-fg-mid)]">{member.isNju ? "南京大学资格成员" : member.institutionName ?? "未声明学校"} · {EDUCATION[member.educationStatus]} · {member.emailVerified ? "邮箱已验证" : "邮箱未验证"}</p>{member.disciplineBlocked && <p className="mt-1 text-xs text-[var(--color-danger)]">存在有效报名禁赛处罚</p>}{member.readinessBlockers.length > 0 && <p className="mt-1 text-xs leading-5 text-[var(--color-warn)]">{member.readinessBlockers.join(" ")}</p>}</div>)}</div></section>
    </div></Panel>;
  })}</div>;
}
