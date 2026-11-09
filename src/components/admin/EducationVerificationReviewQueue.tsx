"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { reviewEducationVerification as telemetry_reviewEducationVerification } from "@/actions/education-verifications";
import { EmptyState, Panel } from "@/components/rivalhub";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatCST } from "@/lib/utils/date";
import {
  EDUCATION_REVIEW_NOTE_MAX_LENGTH,
  type EducationReviewRow,
} from "@/lib/education/admin-review-contract";
import { observeAction } from "@/lib/telemetry/client";

const reviewEducationVerification = observeAction(
  "education-verifications.reviewEducationVerification",
  telemetry_reviewEducationVerification,
);

export type EducationReviewEmptyState = "no-records" | "no-pending" | "no-results";

function isChsiEvidenceLabel(label: EducationReviewRow["evidenceLabel"]): boolean {
  return label === "学信网学籍在线验证报告" || label === "学信网学历材料";
}

interface EducationVerificationReviewQueueProps {
  rows: EducationReviewRow[];
  emptyState: EducationReviewEmptyState;
}

interface ReviewSelection extends Pick<
  EducationReviewRow,
  "id" | "displayName" | "email" | "institution"
> {
  decision: "approved" | "rejected";
}

export function EducationVerificationReviewQueue({
  rows,
  emptyState,
}: EducationVerificationReviewQueueProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [note, setNote] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const originRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();

  function openReview(
    { id, displayName, email, institution }: EducationReviewRow,
    decision: ReviewSelection["decision"],
    origin: HTMLButtonElement,
  ) {
    originRef.current = origin;
    setNote("");
    setReviewError(null);
    setSelection({ id, displayName, email, institution, decision });
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || pending) return;
    const { id, decision } = selection;
    const reviewNote = note.trim();
    if (decision === "rejected" && !reviewNote) {
      setReviewError("请填写驳回原因。");
      noteRef.current?.focus();
      return;
    }
    setReviewError(null);
    startTransition(async () => {
      try {
        const result = await reviewEducationVerification({ id, decision, reviewNote });
        if (!result.success) {
          setReviewError(result.error.message);
          return;
        }
        setSelection(null);
        toast.success(decision === "approved" ? "认证已通过" : "认证已驳回");
        router.refresh();
      } catch {
        setReviewError("未能确认审核结果，请返回队列刷新后核对。");
      }
    });
  }

  const copyEvidenceCode = (evidenceCode: string) =>
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(evidenceCode);
        toast.success("在线验证码已复制");
      } catch {
        toast.error("无法复制验证码，请手动复制");
      }
    });

  return (
    <div className="min-w-0 space-y-4">
      {pending && (
        <div className="flex justify-end">
          <span className="text-xs text-[var(--color-accent)]">处理中…</span>
        </div>
      )}
      {rows.length === 0 ? (
        <Panel contentClassName="p-0">
          <EmptyState
            title={
              emptyState === "no-records"
                ? "当前没有教育认证记录"
                : emptyState === "no-pending"
                  ? "当前没有待审核认证"
                  : "当前筛选没有匹配结果"
            }
            sub={
              emptyState === "no-records"
                ? "新的教育认证提交后会出现在这里。"
                : emptyState === "no-pending"
                  ? "可以切换状态查看历史审核记录。"
                  : "可以调整搜索条件或清除筛选。"
            }
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Panel key={row.id} contentClassName="p-5">
              <div className="space-y-2">
                <p className="font-semibold">
                  {row.displayName ?? "未知用户"} ·{" "}
                  {row.status === "pending"
                    ? "待审核"
                    : row.status === "approved"
                      ? "已通过"
                      : "已驳回"}
                </p>
                <p className="text-sm text-[var(--color-fg-mid)]">账号：{row.email}</p>
                <p className="text-sm">
                  声明学校：{row.institution}
                  {row.code ? `（${row.code}）` : ""} ·{" "}
                  {row.academicStatus === "enrolled" ? "在读" : "已毕业"}
                </p>
                <p className="text-sm">提交时间：{formatCST(row.submittedAt)}</p>
                <p className="text-sm">材料：{row.evidenceLabel}</p>
                {row.chsiEvidenceCode ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm">
                      在线验证码：<span className="font-mono">{row.chsiEvidenceCode}</span>
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => copyEvidenceCode(row.chsiEvidenceCode!)}
                    >
                      复制验证码
                    </Button>
                    <a
                      className="text-sm underline"
                      href="https://www.chsi.com.cn/xlcx/bgcx.jsp"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      在学信网核验 ↗
                    </a>
                  </div>
                ) : row.evidenceLabel === "录取通知书材料" && row.manualEvidenceAvailable ? (
                  <Button size="sm" variant="outline" asChild data-pending={pending || undefined}>
                    <a
                      href={`/admin/education-verifications/${row.id}/evidence`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-disabled={pending}
                      onClick={pending ? (event) => event.preventDefault() : undefined}
                    >
                      查看材料
                    </a>
                  </Button>
                ) : row.status !== "pending" && row.evidenceLabel === "录取通知书材料" ? (
                  <p className="text-sm text-[var(--color-fg-mid)]">
                    录取通知书材料：已过保留期或已清理
                  </p>
                ) : row.status !== "pending" && isChsiEvidenceLabel(row.evidenceLabel) ? (
                  <p className="text-sm text-[var(--color-fg-mid)]">
                    在线验证码：已过保留期或已清理
                  </p>
                ) : null}
                {row.reviewNote && (
                  <p className="text-sm text-[var(--color-fg-mid)]">审核备注：{row.reviewNote}</p>
                )}
                {row.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      disabled={pending}
                      aria-haspopup="dialog"
                      onClick={(event) => openReview(row, "approved", event.currentTarget)}
                    >
                      通过
                    </Button>
                    <Button
                      disabled={pending}
                      variant="outline"
                      aria-haspopup="dialog"
                      onClick={(event) => openReview(row, "rejected", event.currentTarget)}
                    >
                      驳回
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
      <AlertDialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setSelection(null);
        }}
      >
        {selection && (
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              originRef.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {selection.decision === "approved" ? "通过这项教育认证？" : "驳回这项教育认证？"}
              </AlertDialogTitle>
              <AlertDialogDescription className="[overflow-wrap:anywhere]">
                {selection.displayName ?? "未知用户"}（{selection.email}） · {selection.institution}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form className="space-y-4" onSubmit={review} noValidate>
              <div className="space-y-2">
                <label htmlFor={noteId} className="block text-sm font-medium">
                  {selection.decision === "approved" ? "审核备注（可选）" : "驳回原因（必填）"}
                </label>
                <Textarea
                  id={noteId}
                  ref={noteRef}
                  aria-describedby={`${noteId}-help`}
                  aria-invalid={
                    Boolean(reviewError) && selection.decision === "rejected" && !note.trim()
                  }
                  required={selection.decision === "rejected"}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                    setReviewError(null);
                  }}
                  maxLength={EDUCATION_REVIEW_NOTE_MAX_LENGTH}
                  disabled={pending}
                  rows={3}
                />
                <p id={`${noteId}-help`} className="text-sm text-[var(--color-fg-secondary)]">
                  {selection.decision === "approved"
                    ? "审核备注仅管理员可见。"
                    : "驳回原因将显示给申请人。"}
                </p>
              </div>
              {reviewError && (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  {reviewError}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={pending}>
                  返回审核队列
                </AlertDialogCancel>
                <Button
                  type="submit"
                  variant={selection.decision === "approved" ? "default" : "destructive"}
                  disabled={pending}
                >
                  {pending
                    ? "正在提交…"
                    : selection.decision === "approved"
                      ? "确认通过"
                      : "确认驳回"}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}
