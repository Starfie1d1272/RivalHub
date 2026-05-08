"use client";

import type { DraftTeamSlot } from "@/lib/draft/data";

const POS_SHORT: Record<string, string> = {
  igl: "IGL",
  awper: "AWP",
  opener: "突破",
  closer: "自由",
  anchor: "主防",
};

interface TeamDraftGridProps {
  teams: DraftTeamSlot[];
  currentTeamId: string | null;
  totalRounds: number;
  currentRound: number;
}

export function TeamDraftGrid({
  teams,
  currentTeamId,
  totalRounds,
  currentRound,
}: TeamDraftGridProps) {
  // sort by draftOrder
  const sorted = [...teams].sort((a, b) => a.draftOrder - b.draftOrder);

  if (sorted.length === 0) {
    return (
      <div className="py-24 text-center text-[var(--text-muted)]">
        <p className="text-lg">暂无队伍数据</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {sorted.map((team) => {
        const isCurrent = team.teamId === currentTeamId;
        const maxSlots = totalRounds; // 6 picks per team
        const filledSlots = team.members.length;
        const emptySlots = Math.max(0, maxSlots - filledSlots);

        return (
          <div
            key={team.teamId}
            className={`rounded-lg border p-3 sm:p-4 transition-colors ${
              isCurrent
                ? "border-[var(--season-primary)] bg-[var(--season-primary)]/5"
                : "border-[var(--border)] bg-[var(--bg-elevated)]"
            }`}
          >
            {/* 队名 + draft order */}
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)] truncate">
                {team.teamName}
              </h3>
              <span className="text-xs text-[var(--text-muted)] tabular">
                #{team.draftOrder}
              </span>
            </div>

            {/* 队长 */}
            <div className="text-xs mb-1">
              <span className="text-[var(--text-muted)]">队长 </span>
              <span className="text-[var(--text-primary)] font-medium">
                {team.captain.steamName}
              </span>
              <span className="text-[var(--text-muted)] ml-1">
                {POS_SHORT[team.captain.primaryPosition] ?? team.captain.primaryPosition}
              </span>
            </div>

            {/* 已选队员 */}
            {team.members.map((m) => (
              <div key={m.registrationId} className="text-xs mb-0.5">
                <span className="text-[var(--text-secondary)]">
                  R{m.pickRound}P{m.pickNumber}{" "}
                </span>
                <span className="text-[var(--text-primary)]">
                  {m.steamName}
                </span>
                <span className="text-[var(--text-muted)] ml-1">
                  {POS_SHORT[m.primaryPosition] ?? m.primaryPosition}
                </span>
                {m.autoPicked && (
                  <span className="text-amber-400 ml-0.5">⚡</span>
                )}
              </div>
            ))}

            {/* 空位 */}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="text-xs text-[var(--text-muted)] mb-0.5"
              >
                ??? · ??? · 待选
              </div>
            ))}

            {/* 满员标记 */}
            {emptySlots === 0 && (
              <div className="text-xs text-emerald-400 mt-1">阵容已满</div>
            )}

            {isCurrent && (
              <div className="mt-2 text-xs font-medium text-[var(--season-primary)]">
                第 {currentRound} 轮 · 选择中…
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
