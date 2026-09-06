"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { reviewEducationVerification } from "@/actions/education-verifications";
import { EmptyState, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { formatCST } from "@/lib/utils/date";
import type { EducationReviewRow } from "@/lib/education/admin-review-contract";

interface EducationVerificationReviewQueueProps {
  rows: EducationReviewRow[];
  hasAnyRecords: boolean;
}

function isChsiEvidenceType(evidenceType: string): boolean {
  return evidenceType === "chsi_enrollment_report" || evidenceType === "chsi_education_report";
}

export function EducationVerificationReviewQueue({ rows, hasAnyRecords }: EducationVerificationReviewQueueProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const review = (id: string, decision: "approved" | "rejected") => {
    const reviewNote = decision === "rejected"
      ? window.prompt("请输入驳回原因（将显示给申请人）") ?? ""
      : window.prompt("审核备注（可选，仅管理员可见）") ?? "";
    if (decision === "rejected" && !reviewNote.trim()) return;
    startTransition(async () => {
      const result = await reviewEducationVerification({ id, decision, reviewNote });
      if (result.success) {
        toast.success(decision === "approved" ? "认证已通过" : "认证已驳回");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  };

  const copyEvidenceCode = (evidenceCode: string) => startTransition(async () => {
    try {
      await navigator.clipboard.writeText(evidenceCode);
      toast.success("在线验证码已复制");
    } catch {
      toast.error("无法复制验证码，请手动复制");
    }
  });

  return (
    <div className="min-w-0 space-y-4">
      {pending && <div className="flex justify-end"><span className="text-xs text-[var(--color-accent)]">处理中…</span></div>}
      {rows.length === 0 ? (
        <Panel contentClassName="p-0">
          <EmptyState
            title={hasAnyRecords ? "当前筛选没有匹配结果" : "当前没有教育认证记录"}
            sub={hasAnyRecords ? "可以调整搜索条件或清除筛选。" : "新的教育认证提交后会出现在这里。"}
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Panel key={row.id} contentClassName="p-5">
              <div className="space-y-2">
                <p className="font-semibold">
                  {row.displayName || row.email} · {row.status === "pending" ? "待审核" : row.status === "approved" ? "已通过" : "已驳回"}
                </p>
                <p className="text-sm text-[var(--color-fg-mid)]">账号：{row.email}</p>
                <p className="text-sm">声明学校：{row.institution}{row.code ? `（${row.code}）` : ""} · {row.academicStatus === "enrolled" ? "在读" : "已毕业"}</p>
                <p className="text-sm">提交时间：{formatCST(row.submittedAt)}</p>
                <p className="text-sm">证据类型：{row.evidenceType}</p>
                {row.evidenceCode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm">在线验证码：<span className="font-mono">{row.evidenceCode}</span></p>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => copyEvidenceCode(row.evidenceCode!)}>复制验证码</Button>
                    <a className="text-sm underline" href="https://www.chsi.com.cn/xlcx/bgcx.jsp" target="_blank" rel="noopener noreferrer">在学信网核验 ↗</a>
                  </div>
                ) : row.status !== "pending" && isChsiEvidenceType(row.evidenceType) ? (
                  <p className="text-sm text-[var(--color-fg-mid)]">在线验证码：已按保留策略清理</p>
                ) : null}
                {row.reviewNote && <p className="text-sm text-[var(--color-fg-mid)]">审核备注：{row.reviewNote}</p>}
                {row.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button disabled={pending} onClick={() => review(row.id, "approved")}>通过</Button>
                    <Button disabled={pending} variant="outline" onClick={() => review(row.id, "rejected")}>驳回</Button>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
