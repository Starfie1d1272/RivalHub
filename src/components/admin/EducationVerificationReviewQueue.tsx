"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { reviewEducationVerification } from "@/actions/education-verifications";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";

export type EducationReviewRow = { id: string; email: string; displayName: string | null; institution: string; code: string | null; academicStatus: "enrolled" | "graduated"; evidenceType: string; evidenceUrl: string | null; status: "pending" | "approved" | "rejected"; submittedAt: string; reviewNote: string | null };
export function EducationVerificationReviewQueue({ rows }: { rows: EducationReviewRow[] }) {
  const [pending, startTransition] = useTransition();
  const review = (id: string, decision: "approved" | "rejected") => { const reviewNote = decision === "rejected" ? window.prompt("请输入驳回原因（将显示给申请人）") ?? "" : window.prompt("审核备注（可选，仅管理员可见）") ?? ""; if (decision === "rejected" && !reviewNote.trim()) return; startTransition(async () => { const result = await reviewEducationVerification({ id, decision, reviewNote }); if (result.success) toast.success(decision === "approved" ? "认证已通过" : "认证已驳回"); else toast.error(result.error.message); }); };
  return <div className="space-y-4">{rows.length === 0 ? <Panel pad={20}><p className="text-sm text-[var(--color-fg-mid)]">当前没有教育认证记录。</p></Panel> : rows.map((row) => <Panel key={row.id} pad={20}><div className="space-y-2"><p className="font-semibold">{row.displayName || row.email} · {row.status === "pending" ? "待审核" : row.status === "approved" ? "已通过" : "已驳回"}</p><p className="text-sm text-[var(--color-fg-mid)]">账号：{row.email}</p><p className="text-sm">声明学校：{row.institution}{row.code ? `（${row.code}）` : ""} · {row.academicStatus === "enrolled" ? "在读" : "已毕业"}</p><p className="text-sm">证据类型：{row.evidenceType}</p>{row.evidenceUrl && <a className="inline-block text-sm underline" href={row.evidenceUrl} target="_blank" rel="noopener noreferrer">在学信网中打开 ↗</a>}{row.reviewNote && <p className="text-sm text-[var(--color-fg-mid)]">审核备注：{row.reviewNote}</p>}{row.status === "pending" && <div className="flex gap-2"><Button disabled={pending} onClick={() => review(row.id, "approved")}>通过</Button><Button disabled={pending} variant="outline" onClick={() => review(row.id, "rejected")}>驳回</Button></div>}</div></Panel>)}</div>;
}
