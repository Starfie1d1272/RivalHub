"use client";

import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { useTransition, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmCaptains as telemetry_confirmCaptains } from "@/actions/captains";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CAPTAIN_TEAM_COUNT } from "@/lib/captains/rules";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { positionLabel } from "@/lib/validators/registration";
import type { AdminCaptainSeed } from "@/lib/captains/data";
import { observeAction } from "@/lib/telemetry/client";
import type { SeasonStatus } from "@/types/season";

const confirmCaptains = observeAction("captains.confirmCaptains", telemetry_confirmCaptains);

interface CaptainConfirmPanelProps {
  seasonId: string;
  seasonStatus: SeasonStatus;
  teamCount: number;
  candidates: AdminCaptainSeed[];
  candidateCount: number;
  totalVotes: number;
  confirmationBlockedReason: string | null;
}

export function CaptainConfirmPanel({
  seasonId,
  seasonStatus,
  teamCount,
  candidates,
  candidateCount,
  totalVotes,
  confirmationBlockedReason,
}: CaptainConfirmPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ seasonId: string; seeds: AdminCaptainSeed[] } | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmation = preview?.seasonId === seasonId ? preview.seeds : null;

  function handleConfirm() {
    if (!confirmation || isPending) return;
    const expectedCaptains = confirmation.map(({ id, userId }) => ({ registrationId: id, userId }));
    startTransition(async () => {
      try {
        const result = await confirmCaptains({ seasonId, expectedCaptains });
        if (result.success) {
          toast.success(`已生成 ${result.data.entryIds.length} 支队伍`);
        } else {
          setConfirmError(result.error.message);
        }
      } catch {
        setConfirmError("未能确认是否已生成队伍，请刷新后核对队伍和赛事状态。");
      }
      setPreview(null);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">当前前 {CAPTAIN_TEAM_COUNT} 队长</h2>
          <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
            排序规则：票数优先，其次历史最高 Rating，再按报名时间。
          </p>
        </div>

        {candidates.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[var(--color-fg-mid)]">
            暂无可确认的候选人
          </Card>
        ) : (
          <div className="space-y-3">
            {candidates.map((candidate, index) => (
              <Card key={candidate.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">#{index + 1}</Badge>
                      <h3 className="font-semibold">
                        <PlayerProfileLink userId={candidate.userId}>
                          {candidate.displayName}
                        </PlayerProfileLink>
                      </h3>
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                      {positionLabel(candidate.primaryPosition)} · Peak {candidate.peakRating} ·
                      Current {candidate.currentRating}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular">{candidate.voteCount}</div>
                      <div className="text-xs text-[var(--color-fg-mid)]">票</div>
                    </div>
                    <ShieldCheck className="size-5 text-[var(--color-accent)]" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <Card className="p-4">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">确认操作</h2>
              <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                确认后将生成队伍，并进入选秀阶段。
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">赛季状态</span>
                <span>{presentSeasonStatus(seasonStatus).label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">候选人数</span>
                <span>{candidateCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">已投总票数</span>
                <span>{totalVotes}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">已生成队伍</span>
                <span>{teamCount}</span>
              </div>
            </div>

            <AlertDialog
              open={confirmation !== null}
              onOpenChange={(open) => {
                if (isPending) return;
                if (open) setConfirmError(null);
                setPreview(open ? { seasonId, seeds: candidates } : null);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  className="w-full"
                  disabled={Boolean(confirmationBlockedReason) || isPending}
                >
                  <CheckCircle2 />
                  核对前 {CAPTAIN_TEAM_COUNT} 名队长
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认队长并生成队伍？</AlertDialogTitle>
                  <AlertDialogDescription>
                    请核对以下队长及其选秀顺位。确认后按此顺序生成队伍，赛事进入选秀阶段。
                    生成队伍后无法回到投票阶段。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <ol className="list-decimal space-y-1 pl-5 text-sm [overflow-wrap:anywhere]">
                  {confirmation?.map((captain) => (
                    <li key={captain.id}>{captain.displayName}</li>
                  ))}
                </ol>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPending}>返回核对</AlertDialogCancel>
                  <Button type="button" onClick={handleConfirm} disabled={isPending}>
                    {isPending ? "正在生成…" : "确认生成队伍"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {confirmationBlockedReason && (
              <p className="text-xs text-[var(--color-fg-mid)]">{confirmationBlockedReason}</p>
            )}
            {confirmError && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {confirmError}
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
