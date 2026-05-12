"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import { createBrowserClient } from "@/lib/auth/supabase";
import { DraftCountdown } from "./DraftCountdown";
import { TeamDraftGrid } from "./TeamDraftGrid";
import { PlayerPool } from "./PlayerPool";
import type { DraftFullData } from "@/lib/draft/data";

interface DraftLiveRoomProps {
  data: DraftFullData;
  seasonId: string;
  seasonSlug: string;
  seasonPositions: string[];
}

export function DraftLiveRoom({
  data,
  seasonId,
  seasonSlug: _seasonSlug,
  seasonPositions,
}: DraftLiveRoomProps) {
  const router = useRouter();
  const { state, teams, snakeOrder, remainingPlayers, completedPicks, totalPicks, maxPicks } =
    data;

  const isLive = state?.isActive ?? false;

  // 轮询兜底（10 秒刷新）
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [router]);

  // Realtime 订阅
  useEffect(() => {
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
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_picks",
          filter: `season_id=eq.${seasonId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, seasonId]);

  // 确定当前选秀队
  const pickingTeamId = isLive ? state?.currentTeamId ?? null : null;
  const pickingTeam = teams.find((t) => t.teamId === pickingTeamId);

  return (
    <div className="space-y-6">
      {/* 顶部状态栏 */}
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

      {/* 蛇形顺序指示 */}
      {isLive && snakeOrder.length > 0 && (
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
                  title={`R${pick.round}P${pick.pickNumber} ${team?.teamName}: ${pick.steamName}${pick.autoPicked ? " (自动)" : ""}`}
                >
                  <span className="text-[var(--color-fg-dim)] tabular">
                    R{pick.round}P{pick.pickNumber}{" "}
                  </span>
                  <span className="text-[var(--color-fg)]">
                    {pick.steamName}
                  </span>
                  {pick.autoPicked && (
                    <span className="text-amber-400 ml-0.5">⚡</span>
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
          剩余选手池 ({remainingPlayers.length})
        </h2>
        <PlayerPool players={remainingPlayers} seasonPositions={seasonPositions} />
      </section>
    </div>
  );
}
