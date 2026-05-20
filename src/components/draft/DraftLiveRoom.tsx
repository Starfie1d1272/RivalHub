"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import { createBrowserClient } from "@/lib/auth/supabase";
import { getDisplayName } from "@/lib/utils/display-name";
import { DraftCountdown } from "./DraftCountdown";
import { TeamDraftGrid } from "./TeamDraftGrid";
import { PlayerPool } from "./PlayerPool";
import type { DraftFullData } from "@/lib/draft/data";

interface DraftLiveRoomProps {
  data: DraftFullData;
  seasonId: string;
  seasonSlug: string;
  seasonPositions: string[];
  readonly?: boolean;
}

interface PickNotification {
  teamName: string;
  playerName: string;
}

export function DraftLiveRoom({
  data,
  seasonId,
  seasonSlug: _seasonSlug,
  seasonPositions,
  readonly: isReadonly,
}: DraftLiveRoomProps) {
  const router = useRouter();
  const { state, teams, snakeOrder, remainingPlayers, completedPicks, totalPicks, maxPicks } =
    data;

  const isLive = state?.isActive ?? false;

  // Pick notification state
  const [notification, setNotification] = useState<PickNotification | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce refresh to avoid burst DB pressure from Realtime + polling overlap
  const lastRefreshRef = useRef(0);
  const debouncedRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 3000) return;
    lastRefreshRef.current = now;
    router.refresh();
  }, [router]);

  const showPickNotification = useCallback(
    (payload: { steamName?: string; displayName?: string | null; perfectName?: string | null; team_id?: string }) => {
      const teamName =
        teams.find((t) => t.teamId === payload.team_id)?.teamName ?? "未知队伍";
      const playerName = getDisplayName(payload);

      setNotification({ teamName, playerName });
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

  // 轮询兜底（10 秒刷新）—— 仅直播模式
  useEffect(() => {
    if (isReadonly) return;
    const timer = window.setInterval(debouncedRefresh, 10_000);
    return () => window.clearInterval(timer);
  }, [debouncedRefresh, isReadonly]);

  // Realtime 订阅 —— 仅直播模式
  useEffect(() => {
    if (isReadonly) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`draft-live:${seasonId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_state",
          filter: `season_id=eq.${seasonId}`,
        },
        () => debouncedRefresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_picks",
          filter: `season_id=eq.${seasonId}`,
        },
        () => {
          debouncedRefresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [debouncedRefresh, seasonId, isReadonly]);

  // Watch for new picks via completedPicks changes
  const prevPickCountRef = useRef(completedPicks.length);
  useEffect(() => {
    if (completedPicks.length > prevPickCountRef.current) {
      const latestPick = completedPicks[completedPicks.length - 1];
      if (latestPick) {
        showPickNotification({
          steamName: latestPick.steamName,
          displayName: latestPick.displayName,
          perfectName: latestPick.perfectName,
          team_id: latestPick.teamId,
        });
      }
    }
    prevPickCountRef.current = completedPicks.length;
  }, [completedPicks, showPickNotification]);

  // 确定当前选秀队
  const pickingTeamId = isLive ? state?.currentTeamId ?? null : null;
  const pickingTeam = teams.find((t) => t.teamId === pickingTeamId);

  return (
    <div className="space-y-6">
      {/* Pick notification banner —— 仅直播模式 */}
      {!isReadonly && notification && (
        <div
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center px-4 py-3 text-sm font-medium text-white transition-opacity duration-300"
          style={{
            background: "var(--color-accent)",
            opacity: notificationVisible ? 1 : 0,
            pointerEvents: notificationVisible ? "auto" : "none",
          }}
          role="status"
          aria-live="polite"
        >
          {"🎯"} {notification.teamName} 选择了 {notification.playerName}
        </div>
      )}

      {/* 顶部状态栏 —— 仅直播模式 */}
      {!isReadonly && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-sm">
              <span className="text-[var(--color-fg-mid)]">进度 </span>
              <span className="text-[var(--color-fg)] font-semibold tabular">
                {totalPicks} / {maxPicks}
              </span>
            </div>
            {state && (
              <div className="text-sm">
                <span className="text-[var(--color-fg-mid)]">第 </span>
                <span className="text-[var(--color-fg)] font-semibold tabular">
                  {state.currentRound}
                </span>
                <span className="text-[var(--color-fg-mid)]"> / {DRAFT_TOTAL_ROUNDS} 轮</span>
              </div>
            )}
            {pickingTeam && isLive && (
              <div className="text-sm">
                <span className="text-[var(--color-fg-mid)]">当前 </span>
                <span className="text-[var(--color-accent)] font-semibold">
                  {pickingTeam.teamName}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-fg-dim)]">
              {isLive ? "倒计时" : "已暂停"}
            </span>
            <DraftCountdown
              deadline={state?.roundDeadline ?? null}
              isActive={isLive}
            />
          </div>
        </div>
      )}

      {/* 队伍网格 */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
          队伍阵容
        </h2>
        <TeamDraftGrid
          teams={teams}
          currentTeamId={pickingTeamId}
          totalRounds={DRAFT_TOTAL_ROUNDS}
          currentRound={state?.currentRound ?? 1}
        />
      </section>

      {/* 蛇形顺序指示 —— 仅直播模式 */}
      {!isReadonly && isLive && snakeOrder.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-dim)] overflow-x-auto">
          <span>蛇形顺序：</span>
          {snakeOrder.map((tid) => {
            const t = teams.find((tt) => tt.teamId === tid);
            const isNow = tid === pickingTeamId;
            return (
              <span
                key={tid}
                className={`px-1.5 py-0.5 rounded tabular ${
                  isNow
                    ? "bg-[var(--color-accent)] text-white font-medium"
                    : "text-[var(--color-fg-mid)]"
                }`}
              >
                {t?.teamName ?? tid.slice(0, 6)}
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
              const team = teams.find((t) => t.teamId === pick.teamId);
              return (
                <div
                  key={`${pick.registrationId}-${pick.pickNumber}`}
                  className="px-2 py-1 rounded bg-[var(--color-panel)] border border-[var(--color-border)] truncate"
                  title={`R${pick.round}P${pick.pickNumber} ${team?.teamName}: ${getDisplayName(pick)}${pick.autoPicked ? " (自动)" : ""}`}
                >
                  <span className="text-[var(--color-fg-dim)] tabular">
                    R{pick.round}P{pick.pickNumber}{" "}
                  </span>
                  <span className="text-[var(--color-fg)]">
                    {getDisplayName(pick)}
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
      <section>
        <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] mb-3 uppercase tracking-wider">
          {isReadonly ? "选手池" : "剩余选手池"} ({remainingPlayers.length})
        </h2>
        <PlayerPool players={remainingPlayers} seasonPositions={seasonPositions} />
      </section>
    </div>
  );
}
