"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Pause, RotateCcw } from "lucide-react";
import { startDraft, pauseDraft, resumeDraft } from "@/actions/draft";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import type { DraftFullData } from "@/lib/draft/data";

interface DraftAdminPanelProps {
  seasonId: string;
  seasonName: string;
  seasonStatus: string;
  teamCount: number;
  data: DraftFullData | null;
}

export function DraftAdminPanel({
  seasonId,
  seasonName,
  seasonStatus,
  teamCount,
  data,
}: DraftAdminPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const state = data?.state ?? null;
  const isLive = state?.isActive ?? false;
  const isDrafting = seasonStatus === "drafting";
  const canStart =
    isDrafting && !state && teamCount > 0;
  const canPause = isLive;
  const canResume = isDrafting && state && !isLive;

  function handleStart() {
    startTransition(async () => {
      const result = await startDraft({ seasonId });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success("选秀已启动");
      router.refresh();
    });
  }

  function handlePause() {
    startTransition(async () => {
      const result = await pauseDraft({ seasonId });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success("选秀已暂停");
      router.refresh();
    });
  }

  function handleResume() {
    startTransition(async () => {
      const result = await resumeDraft({ seasonId });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success("选秀已恢复");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* 状态卡片 */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">{seasonName} · 选秀控制</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-sm">
          <div>
            <span className="text-[var(--color-fg-dim)]">赛季状态</span>
            <p className="font-medium text-[var(--color-fg)]">{seasonStatus}</p>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">队伍数</span>
            <p className="font-medium text-[var(--color-fg)]">{teamCount}</p>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">选秀状态</span>
            <p className="font-medium text-[var(--color-fg)]">
              {state ? (isLive ? "进行中" : "已暂停") : "未启动"}
            </p>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">进度</span>
            <p className="font-medium text-[var(--color-fg)] tabular">
              {state
                ? `第 ${state.currentRound} / ${DRAFT_TOTAL_ROUNDS} 轮`
                : "-"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canStart && (
            <Button
              onClick={handleStart}
              disabled={isPending}
              style={{
                backgroundColor: "var(--color-accent)",
                color: "#fff",
              }}
            >
              <Play size={16} className="mr-1.5" />
              启动选秀
            </Button>
          )}
          {canPause && (
            <Button
              variant="outline"
              onClick={handlePause}
              disabled={isPending}
            >
              <Pause size={16} className="mr-1.5" />
              暂停
            </Button>
          )}
          {canResume && (
            <Button
              onClick={handleResume}
              disabled={isPending}
              style={{
                backgroundColor: "var(--color-accent)",
                color: "#fff",
              }}
            >
              <RotateCcw size={16} className="mr-1.5" />
              恢复选秀
            </Button>
          )}
          {!isDrafting && (
            <p className="text-sm text-[var(--color-fg-dim)]">
              赛季状态需为 "drafting" 才能操作选秀。请先在队长确认页面确认队长生成队伍。
            </p>
          )}
          {isDrafting && teamCount === 0 && (
            <p className="text-sm text-[var(--color-fg-dim)]">
              尚未生成队伍。请先在队长确认页面确认队长。
            </p>
          )}
        </div>
      </Card>

      {/* 当前详情 */}
      {state && data && (
        <Card className="p-6">
          <h3 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
            当前详情
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[var(--color-fg-dim)]">当前轮次：</span>
              <span className="text-[var(--color-fg)] tabular ml-1">
                第 {state.currentRound} 轮
              </span>
            </div>
            <div>
              <span className="text-[var(--color-fg-dim)]">当前队伍：</span>
              <span className="text-[var(--color-fg)] ml-1">
                {data.teams.find((t) => t.teamId === state.currentTeamId)?.teamName ??
                  "无"}
              </span>
            </div>
            <div>
              <span className="text-[var(--color-fg-dim)]">已完成 picks：</span>
              <span className="text-[var(--color-fg)] tabular ml-1">
                {data.totalPicks} / {data.maxPicks}
              </span>
            </div>
            <div>
              <span className="text-[var(--color-fg-dim)]">剩余可选：</span>
              <span className="text-[var(--color-fg)] tabular ml-1">
                {data.remainingPlayers.length} 人
              </span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
