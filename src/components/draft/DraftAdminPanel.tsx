"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Pause, RotateCcw } from "lucide-react";
import {
  startDraft as telemetry_startDraft,
  pauseDraft as telemetry_pauseDraft,
  resumeDraft as telemetry_resumeDraft,
  skipDraftTurn,
} from "@/actions/draft";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRoutePolling } from "@/components/use-visible-polling";
import { DRAFT_TEAMS, DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import type { SeasonStatus } from "@/types/season";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import type { DraftAdminData } from "@/lib/draft/data";
import { getNextEntryId, isDraftComplete } from "@/lib/draft/rules";
import type { DraftTurnInput } from "@/lib/validators/draft";
import { observeAction } from "@/lib/telemetry/client";

const startDraft = observeAction("draft.startDraft", telemetry_startDraft);
const pauseDraft = observeAction("draft.pauseDraft", telemetry_pauseDraft);
const resumeDraft = observeAction("draft.resumeDraft", telemetry_resumeDraft);

const activeTurnLabels = {
  open: "进行中",
  timed_out: "已超时",
  blocked: "等待赛务处理",
};

interface DraftAdminPanelProps {
  seasonId: string;
  seasonName: string;
  seasonStatus: SeasonStatus;
  teamCount: number;
  data: DraftAdminData | null;
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
  const [skipTurn, setSkipTurn] = useState<{
    expectedTurn: DraftTurnInput;
    teamName: string;
    completesDraft: boolean;
  } | null>(null);
  const [skipFeedback, setSkipFeedback] = useState("");
  const didConfirmSkip = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);

  const state = data?.state ?? null;
  const isComplete = Boolean(
    data?.state &&
    !data.state.isActive &&
    isDraftComplete(data.state.currentRound, data.state.currentEntryId, data.totalPicks),
  );
  const isDrafting = seasonStatus === "drafting";
  const canStart = Boolean(data && isDrafting && !state && teamCount > 0);
  const canPause = isDrafting && Boolean(state?.isActive);
  const canResume = isDrafting && Boolean(state?.currentEntryId && !state.isActive);
  const currentTeam = data?.teams.find((team) => team.entryId === state?.currentEntryId);
  const { refresh, refreshPending } = useRoutePolling(
    canPause ? 15_000 : null,
    isPending || skipTurn !== null,
  );
  const busy = isPending || refreshPending;

  const draftLabel = !data
    ? "未启用"
    : isComplete
      ? "已完成"
      : !state
        ? "未启动"
        : state.isActive
          ? activeTurnLabels[data.turnStatus ?? "open"]
          : "已暂停";

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

  function handleSkipDialog(open: boolean) {
    if (!open) {
      setSkipTurn(null);
      return;
    }
    if (!data || !state?.currentEntryId || !state.roundDeadline) return;
    const next = getNextEntryId(
      data.teams.map((team) => ({ id: team.entryId, draftOrder: team.draftOrder })),
      state.currentEntryId,
      state.currentRound,
    );
    setSkipTurn({
      expectedTurn: {
        entryId: state.currentEntryId,
        round: state.currentRound,
        deadline: state.roundDeadline,
      },
      teamName: currentTeam?.teamName ?? "当前队伍",
      completesDraft: !next,
    });
  }

  function handleSkip(expectedTurn: DraftTurnInput) {
    didConfirmSkip.current = true;
    setSkipFeedback("正在核对本轮并提交跳过操作…");
    startTransition(async () => {
      try {
        const result = await skipDraftTurn({ seasonId, expectedTurn });
        setSkipFeedback(
          result.success
            ? result.data.completed
              ? "已跳过本次选人，选秀已完成。"
              : "已跳过本次选人。"
            : result.error.message,
        );
      } catch {
        setSkipFeedback("跳过结果暂未确认，请核对当前选秀状态。");
      } finally {
        router.refresh();
      }
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
            <p className="font-medium text-[var(--color-fg)]">
              {presentSeasonStatus(seasonStatus).label}
            </p>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">队伍数</span>
            <p className="font-medium text-[var(--color-fg)]">{teamCount}</p>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">选秀状态</span>
            <p className="font-medium text-[var(--color-fg)]">{draftLabel}</p>
          </div>
          <div>
            <span className="text-[var(--color-fg-dim)]">进度</span>
            <p className="font-medium text-[var(--color-fg)] tabular">
              {isComplete
                ? `共 ${DRAFT_TOTAL_ROUNDS} 轮`
                : state ? `第 ${state.currentRound} / ${DRAFT_TOTAL_ROUNDS} 轮` : "—"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canStart && (
            <Button
              onClick={handleStart}
              disabled={busy}
              style={{
                backgroundColor: "var(--color-accent)",
                color: "var(--color-accent-fg)",
              }}
            >
              <Play size={16} className="mr-1.5" />
              启动选秀
            </Button>
          )}
          {canPause && (
            <Button variant="outline" onClick={handlePause} disabled={busy}>
              <Pause size={16} className="mr-1.5" />
              暂停
            </Button>
          )}
          {canResume && (
            <Button
              onClick={handleResume}
              disabled={busy}
              style={{
                backgroundColor: "var(--color-accent)",
                color: "var(--color-accent-fg)",
              }}
            >
              <RotateCcw size={16} className="mr-1.5" />
              恢复选秀
            </Button>
          )}
          {data && (
            <Button variant="ghost" onClick={refresh} disabled={busy}>
              刷新状态
            </Button>
          )}
        </div>
        {data && !state && (seasonStatus === "voting" || (isDrafting && !canStart)) && (
          <p className="mt-3 text-sm text-[var(--color-fg-dim)]">
            选秀需要 {DRAFT_TEAMS} 支队伍。请先在队长确认页面确认队长并生成队伍。
          </p>
        )}
        {canPause && data?.turnStatus === "timed_out" && (
          <p className="mt-3 text-sm text-[var(--color-fg-mid)]">本轮已超时，等待自动选人。</p>
        )}
        {canPause && data?.turnStatus === "blocked" && state?.currentEntryId && state.roundDeadline && (
          <div className="mt-4 space-y-3 rounded-md border border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] p-3">
            <p className="text-sm text-[var(--color-fg)]">
              本轮已超时，当前队伍没有符合自动选人条件的选手。
            </p>
            <AlertDialog open={skipTurn !== null} onOpenChange={handleSkipDialog}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy}>
                  跳过本次选人
                </Button>
              </AlertDialogTrigger>
              {skipTurn && (
                <AlertDialogContent
                  onCloseAutoFocus={(event) => {
                    if (!didConfirmSkip.current) return;
                    didConfirmSkip.current = false;
                    event.preventDefault();
                    feedback.current?.focus();
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      跳过「{skipTurn.teamName}」第 {skipTurn.expectedTurn.round} 轮的选人？
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      此名额将保留空缺。
                      {skipTurn.completesDraft
                        ? "现有阵容将锁定，赛事进入比赛阶段。"
                        : "选秀将继续到下一个选人顺位。"}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleSkip(skipTurn.expectedTurn)}>
                      确认跳过
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              )}
            </AlertDialog>
          </div>
        )}
        <p
          ref={feedback}
          tabIndex={-1}
          role="status"
          className={skipFeedback ? "mt-3 text-sm text-[var(--color-fg)]" : "sr-only"}
        >
          {skipFeedback}
        </p>
      </Card>

      {/* 当前详情 */}
      {state && data && (
        <Card className="p-6">
          <h3 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
            {isComplete ? "选秀结果" : "当前详情"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {!isComplete && (
              <>
                <div>
                  <span className="text-[var(--color-fg-dim)]">当前轮次：</span>
                  <span className="text-[var(--color-fg)] tabular ml-1">
                    第 {state.currentRound} 轮
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-fg-dim)]">当前队伍：</span>
                  <span className="text-[var(--color-fg)] ml-1">
                    <TeamProfileLink entryId={state.currentEntryId}>
                      {currentTeam?.teamName ?? "无"}
                    </TeamProfileLink>
                  </span>
                </div>
              </>
            )}
            <div>
              <span className="text-[var(--color-fg-dim)]">已选人数：</span>
              <span className="text-[var(--color-fg)] tabular ml-1">
                {data.totalPicks} / {data.maxPicks}
              </span>
            </div>
            {!isComplete && (
              <div>
                <span className="text-[var(--color-fg-dim)]">待选池人数：</span>
                <span className="text-[var(--color-fg)] tabular ml-1">
                  {data.remainingPlayerCount} 人
                </span>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
