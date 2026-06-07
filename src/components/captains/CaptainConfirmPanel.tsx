"use client";

import { useTransition, useState } from "react";
import { CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmCaptains } from "@/actions/captains";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CAPTAIN_TEAM_COUNT } from "@/lib/captains/rules";
import { positionLabel } from "@/lib/validators/registration";
import type { CaptainCandidateRow } from "@/lib/captains/data";

interface CaptainConfirmPanelProps {
  seasonId: string;
  seasonStatus: string;
  teamCount: number;
  candidates: CaptainCandidateRow[];
}

export function CaptainConfirmPanel({
  seasonId,
  seasonStatus,
  teamCount,
  candidates,
}: CaptainConfirmPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const seeds = candidates.slice(0, CAPTAIN_TEAM_COUNT);
  const canConfirm =
    seasonStatus === "voting" &&
    teamCount === 0 &&
    seeds.length === CAPTAIN_TEAM_COUNT;

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmCaptains({ seasonId });
      setShowConfirmDialog(false);
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`已生成 ${result.data.teamIds.length} 支队伍`);
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

        {seeds.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[var(--color-fg-mid)]">
            暂无可确认的候选人
          </Card>
        ) : (
          <div className="space-y-3">
            {seeds.map((candidate, index) => (
              <Card key={candidate.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">#{index + 1}</Badge>
                      <h3 className="font-semibold">{candidate.displayName}</h3>
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
                确认后会生成队伍、写入队长成员，并将赛季推进到 drafting。
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">赛季状态</span>
                <span>{seasonStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">候选人数</span>
                <span>{candidates.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-fg-mid)]">已生成队伍</span>
                <span>{teamCount}</span>
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!canConfirm || isPending}
              onClick={() => setShowConfirmDialog(true)}
            >
              <CheckCircle2 />
              确认前 {CAPTAIN_TEAM_COUNT}
            </Button>

            {!canConfirm && (
              <p className="text-xs text-[var(--color-fg-mid)]">
                仅可在 voting 状态、尚未生成队伍且候选人不少于 {CAPTAIN_TEAM_COUNT} 人时确认。
              </p>
            )}
          </div>
        </Card>
      </aside>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-[var(--color-warn)]" />
              确认队长
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p>
                即将确认前 <strong>{CAPTAIN_TEAM_COUNT}</strong> 名队长并生成队伍，
                赛季将从 <strong>voting</strong> 推进到 <strong>drafting</strong>。
              </p>
              <div className="rounded-md border p-3 text-sm" style={{ borderColor: "rgba(255,196,77,0.4)", background: "rgba(255,196,77,0.08)" }}>
                <p className="font-medium text-[var(--color-warn)]">
                  此操作不可撤销
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-[var(--color-fg-mid)]">
                  <li>将生成 {CAPTAIN_TEAM_COUNT} 支队伍并写入队长成员</li>
                  <li>生成后无法回退到投票阶段</li>
                  <li>选秀顺位由当前票数决定</li>
                </ul>
              </div>
              <p className="text-sm text-[var(--color-fg-mid)]">
                队长列表：
                {seeds.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && "、"}
                    {s.displayName}
                  </span>
                ))}
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? "确认中..." : "确认生成队伍"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

