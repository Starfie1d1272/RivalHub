"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmStoredDemoParticipantIdentity, rejectStoredDemoImport } from "@/actions/demo-integration";
import { InlineConfirm, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import type { AdminDemoReviewMap } from "@/lib/admin/matches/types";

interface DemoDataReviewPanelProps {
  reviews?: AdminDemoReviewMap[];
}

export function DemoDataReviewPanel({ reviews = [] }: DemoDataReviewPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [rejectingImportId, setRejectingImportId] = useState<string | null>(null);
  const router = useRouter();

  if (reviews.length === 0) return null;

  function confirmIdentity(review: AdminDemoReviewMap, observedSteam64: string, eventRosterMemberId: string) {
    startTransition(async () => {
      const result = await confirmStoredDemoParticipantIdentity({
        importId: review.importId,
        observedSteam64,
        eventRosterMemberId,
      });
      if (result.success) {
        toast.success(result.data.status === "confirmed" ? "比赛 Steam 身份已确认，Demo 数据已重新检查。" : "比赛 Steam 身份已保存，但这份 Demo 仍有其他问题需要处理。");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function reject(review: AdminDemoReviewMap) {
    startTransition(async () => {
      const result = await rejectStoredDemoImport({ importId: review.importId });
      if (result.success) {
        toast.success("这份 Demo 数据已拒绝。");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Panel label="Demo 数据需要处理" contentClassName="space-y-5 p-4">
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">
        确认后，以后在 Demo 中发现这个 Steam64 ID 时，会识别为该选手。这不会修改选手登录或报名资料中填写的 Steam64 ID。
      </p>
      {reviews.map((review) => (
        <section key={review.importId} className="space-y-4 rounded border border-[var(--color-border)] p-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">第 {review.mapOrder} 图 · {review.mapName}</h3>
              {!review.invalidPayload && <p className="mt-1 text-xs text-[var(--color-fg-mid)]">请核对 Demo 中的选手身份与当前本场首发。</p>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setRejectingImportId(review.importId)}
            >
              拒绝这份 Demo 数据
            </Button>
          </header>

          {rejectingImportId === review.importId && (
            <InlineConfirm
              danger
              title="确认拒绝这份 Demo 数据？"
              sub="拒绝后不会写入比赛统计；原始 Demo 数据仍会保留。"
              confirmLabel="确认拒绝"
              onCancel={() => setRejectingImportId(null)}
              onConfirm={() => reject(review)}
            />
          )}

          {review.invalidPayload ? (
            <p className="text-sm leading-6 text-[var(--color-warn)]">{review.message}</p>
          ) : (
            <div className="space-y-3">
              {review.participants.map((participant) => (
                <div key={`${review.importId}:${participant.observedSteam64}`} className="rounded border border-[var(--color-border)] p-3">
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-xs text-[var(--color-fg-mid)]">Demo 中发现的选手</p>
                      <p className="mt-1 font-medium">{participant.demoName}</p>
                      <p className="mt-1 font-mono text-xs text-[var(--color-fg-mid)]">Steam64 ID：{participant.observedSteam64}</p>
                      <p className="mt-1 text-xs text-[var(--color-fg-mid)]">队伍：{participant.teamName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-fg-mid)]">可能对应的本场首发选手</p>
                      {participant.candidates.length === 0 ? (
                        <p className="mt-1 text-sm text-[var(--color-warn)]">本场当前首发名单暂无可确认选手。</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {participant.candidates.map((candidate) => (
                            <div key={candidate.eventRosterMemberId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[var(--color-bg-soft)] p-2">
                              <div>
                                <p className="font-medium">{candidate.name}</p>
                                <p className="mt-1 font-mono text-xs text-[var(--color-fg-mid)]">当前资料中的 Steam64 ID：{candidate.steam64 ?? "未填写"}</p>
                              </div>
                              {participant.canConfirm && (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() => confirmIdentity(review, participant.observedSteam64, candidate.eventRosterMemberId)}
                                >
                                  确认是同一位选手
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {participant.note && <p className="mt-2 text-xs leading-5 text-[var(--color-fg-mid)]">{participant.note}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </Panel>
  );
}
