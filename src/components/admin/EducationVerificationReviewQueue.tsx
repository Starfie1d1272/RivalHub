"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { getEducationManualEvidenceUrl, reviewEducationVerification } from "@/actions/education-verifications";
import { EmptyState, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { formatCST } from "@/lib/utils/date";
import type { EducationReviewRow } from "@/lib/education/admin-review-contract";

export type EducationReviewEmptyState = "no-records" | "no-pending" | "no-results";

function isChsiEvidenceLabel(label: EducationReviewRow["evidenceLabel"]): boolean {
  return label === "学信网学籍在线验证报告" || label === "学信网学历材料";
}

interface EducationVerificationReviewQueueProps {
  rows: EducationReviewRow[];
  emptyState: EducationReviewEmptyState;
}

export function EducationVerificationReviewQueue({ rows, emptyState }: EducationVerificationReviewQueueProps) {
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

  const openManualEvidence = (id: string) => startTransition(async () => {
    // Reserve the tab during the click gesture; the signed URL arrives after
    // the server action and would otherwise be vulnerable to popup blocking.
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    const result = await getEducationManualEvidenceUrl({ id });
    if (!result.success) {
      popup?.close();
      toast.error(result.error.message);
      return;
    }
    if (popup) {
      popup.location.href = result.data;
      return;
    }
    const opened = window.open(result.data, "_blank", "noopener,noreferrer");
    if (!opened) toast.error("浏览器阻止了材料窗口，请允许弹出窗口后重试。");
  });

  return (
    <div className="min-w-0 space-y-4">
      {pending && <div className="flex justify-end"><span className="text-xs text-[var(--color-accent)]">处理中…</span></div>}
      {rows.length === 0 ? (
        <Panel contentClassName="p-0">
          <EmptyState
            title={emptyState === "no-records" ? "当前没有教育认证记录" : emptyState === "no-pending" ? "当前没有待审核认证" : "当前筛选没有匹配结果"}
            sub={emptyState === "no-records" ? "新的教育认证提交后会出现在这里。" : emptyState === "no-pending" ? "可以切换状态查看历史审核记录。" : "可以调整搜索条件或清除筛选。"}
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
                <p className="text-sm">材料：{row.evidenceLabel}</p>
                {row.chsiEvidenceCode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm">在线验证码：<span className="font-mono">{row.chsiEvidenceCode}</span></p>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => copyEvidenceCode(row.chsiEvidenceCode!)}>复制验证码</Button>
                    <a className="text-sm underline" href="https://www.chsi.com.cn/xlcx/bgcx.jsp" target="_blank" rel="noopener noreferrer">在学信网核验 ↗</a>
                  </div>
                ) : row.evidenceLabel === "录取通知书材料" && row.manualEvidenceAvailable ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => openManualEvidence(row.id)}>查看材料</Button>
                ) : row.status !== "pending" && row.evidenceLabel === "录取通知书材料" ? (
                  <p className="text-sm text-[var(--color-fg-mid)]">录取通知书材料：已按保留策略清理</p>
                ) : row.status !== "pending" && isChsiEvidenceLabel(row.evidenceLabel) ? (
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
