"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reportDeploymentUpdate } from "@/lib/deployment-update";
import { useGuardedVisiblePolling } from "@/components/use-visible-polling";
import { getNextEntryId } from "@/lib/draft/rules";
import { DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { DraftCountdown } from "./DraftCountdown";
import { TeamDraftGrid } from "./TeamDraftGrid";
import { PlayerPool } from "./PlayerPool";
import type { PublicDraftData } from "@/lib/draft/data";

import { readPublicDraft } from "@/actions/public-draft";

interface DraftLiveRoomProps {
  seasonSlug: string;
  data: PublicDraftData;
  seasonPositions: string[];
  readonly?: boolean;
  mode?: "preview" | "live" | "archive";
}

interface PickNotification {
  userId: string;
  entryId: string;
  teamName: string;
  playerName: string;
}

export function DraftLiveRoom({
  data: initialData,
  seasonPositions,
  seasonSlug,
  readonly: isReadonly,
  mode: initialMode,
}: DraftLiveRoomProps) {
  const router = useRouter();
  const [polled, setPolled] = useState<{ source: typeof initialData; sourceMode: typeof initialMode; data: typeof initialData; mode: "preview" | "live" | "archive" } | null>(null);
  const data = polled?.source === initialData && polled.sourceMode === initialMode ? polled.data : initialData;
  const mode = polled?.source === initialData && polled.sourceMode === initialMode ? polled.mode : initialMode;
  const { state, teams, snakeOrder, remainingPlayers, completedPicks, totalPicks, maxPicks } =
    data;

  const isComplete = maxPicks > 0 && totalPicks >= maxPicks;
  const isArchive = mode === "archive" || (mode === undefined && Boolean(isReadonly));
  const isLive = !isArchive && !isComplete && (state?.isActive ?? false);

  // Pick notification state
  const [notification, setNotification] = useState<PickNotification | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPickNotification = useCallback(
    (payload: { personaName?: string | null; displayName?: string | null; perfectName?: string | null; userId: string; team_id: string }) => {
      const teamName =
        teams.find((t) => t.entryId === payload.team_id)?.teamName ?? "未知队伍";
      const playerName = getPublicDisplayName(payload);

      setNotification({ teamName, playerName, userId: payload.userId, entryId: payload.team_id });
      setNotificationVisible(true);

      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => {
        setNotificationVisible(false);
        // Remove from DOM after fade-out transition
        removeTimerRef.current = setTimeout(() => setNotification(null), 300);
      }, 3000);
    },
    [teams],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    };
  }, []);

  useGuardedVisiblePolling(async (isCurrent) => {
    if (!seasonSlug) return;
    const result = await readPublicDraft(seasonSlug).catch(error => { reportDeploymentUpdate(error); return null; });
    if (!isCurrent()) return;
    if (result?.success) {
      const next = result.data;
      setPolled({ source: initialData, sourceMode: initialMode, ...next });
      if (next.mode !== mode || next.data.state?.isActive !== data.state?.isActive ||
        (next.data.maxPicks > 0 && next.data.totalPicks >= next.data.maxPicks) !== isComplete) router.refresh();
    } else router.refresh();
  }, seasonSlug && !isArchive && !isComplete ? isLive ? 10_000 : 30_000 : null, seasonSlug, true);

  // Watch for new picks via completedPicks changes
  const prevPickCountRef = useRef(completedPicks.length);
  useEffect(() => {
    let notificationTimer: ReturnType<typeof setTimeout> | undefined;
    if (completedPicks.length > prevPickCountRef.current) {
      const latestPick = completedPicks[completedPicks.length - 1];
      if (latestPick) {
        notificationTimer = setTimeout(() => {
          showPickNotification({
            personaName: latestPick.personaName,
            displayName: latestPick.displayName,
            perfectName: latestPick.perfectName,
            team_id: latestPick.entryId,
            userId: latestPick.userId,
          });
        });
      }
    }
    prevPickCountRef.current = completedPicks.length;
    return () => {
      if (notificationTimer) clearTimeout(notificationTimer);
    };
  }, [completedPicks, showPickNotification]);

  // 确定当前选秀队
  const pickingEntryId = !isArchive && !isComplete ? state?.currentEntryId ?? null : null;
  const pickingTeam = teams.find((t) => t.entryId === pickingEntryId);
  const next = state?.currentEntryId && !isComplete ? getNextEntryId(teams.map(team => ({ id: team.entryId, draftOrder: team.draftOrder })), state.currentEntryId, state.currentRound) : null;
  const nextTeam = teams.find(team => team.entryId === next?.entryId);

  return (
    <div className="relative space-y-6">
      {/* Pick notification banner —— 仅直播模式 */}
      {!isArchive && notification && (
        <div
          className="absolute inset-x-0 top-0 z-10 flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium text-[var(--color-accent-fg)] transition-opacity duration-200"
          style={{
            background: "var(--color-accent)",
            opacity: notificationVisible ? 1 : 0,
            pointerEvents: notificationVisible ? "auto" : "none",
          }}
          role="status"
          aria-live="polite"
        >
          {"🎯"} <TeamProfileLink entryId={notification.entryId}>{notification.teamName}</TeamProfileLink> 选择了 <PlayerProfileLink userId={notification.userId}>{notification.playerName}</PlayerProfileLink>
        </div>
      )}

      {!isArchive && <section aria-label="选秀状态" className="grid gap-5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-panel)] p-5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <div><p className="mb-2 text-xs text-[var(--color-fg-mid)]">{isComplete ? "选秀已完成" : !state ? "等待开始" : isLive ? "正在选择" : "选秀暂停"}</p><h2 className="text-2xl font-semibold">{pickingTeam ? <TeamProfileLink entryId={pickingTeam.entryId}>{pickingTeam.teamName}</TeamProfileLink> : isComplete ? "最终阵容已就位" : "队伍阵容预览"}</h2>{pickingTeam?.captain.userId && <p className="mt-1 text-sm text-[var(--color-fg-mid)]">队长 <PlayerProfileLink userId={pickingTeam.captain.userId}>{getPublicDisplayName(pickingTeam.captain)}</PlayerProfileLink></p>}</div>
        <div className="flex gap-8"><div><p className="mb-2 text-xs text-[var(--color-fg-mid)]">已选 / 总计</p><p className="font-mono text-2xl tabular-nums">{totalPicks}<span className="text-base text-[var(--color-fg-mid)]"> / {maxPicks}</span></p></div>{state && <div><p className="mb-2 text-xs text-[var(--color-fg-mid)]">轮次</p><p className="font-mono text-2xl">{state.currentRound}<span className="text-base text-[var(--color-fg-mid)]"> / {DRAFT_TOTAL_ROUNDS}</span></p></div>}</div>
        {isLive && <div className="[&>span]:font-mono [&>span]:text-2xl"><p className="mb-2 text-xs text-[var(--color-fg-mid)]">剩余时间</p><DraftCountdown deadline={state?.roundDeadline ?? null} isActive />{nextTeam && <p className="mt-2 text-xs text-[var(--color-fg-mid)]">下一队 <TeamProfileLink entryId={nextTeam.entryId}>{nextTeam.teamName}</TeamProfileLink></p>}</div>}
      </section>}

      {/* 队伍网格 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
          队伍阵容
        </h2>
        <TeamDraftGrid
          teams={teams}
          currentEntryId={pickingEntryId}
          totalRounds={DRAFT_TOTAL_ROUNDS}
          currentRound={state?.currentRound ?? 1}
          archive={isArchive || isComplete}
          isActive={isLive}
        />
      </section>

      {/* 蛇形顺序指示 —— 仅直播模式 */}
      {!isArchive && isLive && snakeOrder.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-dim)] overflow-x-auto">
          <span>蛇形顺序：</span>
          {snakeOrder.map((tid) => {
            const t = teams.find((tt) => tt.entryId === tid);
            const isNow = tid === pickingEntryId;
            return (
              <span
                key={tid}
                className={`px-1.5 py-0.5 rounded tabular ${
                  isNow
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)] font-medium"
                    : "text-[var(--color-fg-mid)]"
                }`}
              >
                <TeamProfileLink entryId={tid}>{t?.teamName ?? "队伍"}</TeamProfileLink>
              </span>
            );
          })}
        </div>
      )}

      {/* 已完成 pick 历史 */}
      {completedPicks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
            选秀记录
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-1 text-xs">
            {completedPicks.map((pick) => {
              const team = teams.find((t) => t.entryId === pick.entryId);
              return (
                <div
                  key={pick.pickNumber}
                  className="px-2 py-1 rounded bg-[var(--color-panel)] border border-[var(--color-border)] truncate"
                  title={`R${pick.round}P${pick.pickNumber} ${team?.teamName}: ${getPublicDisplayName(pick)}${pick.autoPicked ? " (自动)" : ""}`}
                >
                  <span className="text-[var(--color-fg-dim)] tabular">
                    R{pick.round}P{pick.pickNumber}{" "}
                  </span>
                  <span className="text-[var(--color-fg)]">
                    <TeamProfileLink entryId={pick.entryId}>{team?.teamName ?? "队伍"}</TeamProfileLink> · <PlayerProfileLink userId={pick.userId}>{getPublicDisplayName(pick)}</PlayerProfileLink>
                  </span>
                  {pick.autoPicked && (
                    <span className="text-[var(--color-warn)] ml-0.5">{"⚡"}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 选手池 */}
      {!isArchive && !isComplete && <section>
        <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
          {isReadonly ? "选手池" : "剩余选手池"} ({remainingPlayers.length})
        </h2>
        <PlayerPool players={remainingPlayers} seasonPositions={seasonPositions} />
      </section>}
    </div>
  );
}
