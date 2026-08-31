"use client";

import { useState } from "react";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { positionLabel } from "@/lib/validators/registration";
import type { DraftTeamSlot } from "@/lib/draft/data";

interface TeamDraftGridProps {
  teams: DraftTeamSlot[];
  currentEntryId: string | null;
  totalRounds: number;
  currentRound: number;
}

export function TeamDraftGrid({
  teams,
  currentEntryId,
  totalRounds,
  currentRound,
}: TeamDraftGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // sort by draftOrder
  const sorted = [...teams].sort((a, b) => a.draftOrder - b.draftOrder);

  if (sorted.length === 0) {
    return (
      <div className="py-24 text-center text-[var(--color-fg-dim)]">
        <p className="text-lg">暂无队伍数据</p>
      </div>
    );
  }

  return (
    <>
      {/* 移动端：手风琴列表 */}
      <div className="md:hidden space-y-2">
        {sorted.map((team) => {
          const isCurrent = team.entryId === currentEntryId;
          const isExpanded = isCurrent || expandedId === team.entryId;
          const emptySlots = Math.max(0, totalRounds - team.members.length);

          return (
            <div
              key={team.entryId}
              className={`border rounded-sm transition-colors ${
                isCurrent
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                  : "border-[var(--color-border)] bg-[var(--color-panel)]"
              }`}
            >
              {/* 折叠头部 */}
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-left"
                onClick={() =>
                  !isCurrent &&
                  setExpandedId(isExpanded ? null : team.entryId)
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isCurrent && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  )}
                  <span
                    className={`text-sm font-bold truncate ${
                      isCurrent
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-fg)]"
                    }`}
                  >
                    {team.teamName}
                  </span>
                </div>
                <span className="font-mono text-xs text-[var(--color-fg-dim)] shrink-0 ml-2">
                  {team.members.length}/{totalRounds}
                </span>
              </button>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-1 border-t border-[var(--color-border)]">
                  {/* 队长行 */}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs text-[var(--color-fg-mid)]">
                      <span className="text-[var(--color-fg-dim)]">队长 </span>
                      {getPublicDisplayName(team.captain)}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-fg-dim)] uppercase">
                      {positionLabel(team.captain.primaryPosition)}
                    </span>
                  </div>
                  {/* 已选队员 */}
                  {team.members.map((m, index) => (
                    <div
                      key={`${team.entryId}-${m.pickNumber || index}`}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-xs text-[var(--color-fg)]">
                        {getPublicDisplayName(m)}
                        {m.autoPicked && (
                          <span className="text-[var(--color-warn)] ml-0.5">⚡</span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-fg-dim)] uppercase">
                        {positionLabel(m.primaryPosition)}
                      </span>
                    </div>
                  ))}
                  {/* 空位占位 */}
                  {Array.from({ length: emptySlots }).map((_, i) => (
                    <div key={`empty-${i}`} className="py-1">
                      <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                        — 待选
                      </span>
                    </div>
                  ))}
                  {emptySlots === 0 && (
                    <div className="py-1 text-xs text-[var(--color-ok)]">
                      阵容已满
                    </div>
                  )}
                  {isCurrent && (
                    <div className="pt-1 text-xs font-medium text-[var(--color-accent)]">
                      第 {currentRound} 轮 · 选择中…
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 桌面端：原有 Grid */}
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {sorted.map((team) => {
          const isCurrent = team.entryId === currentEntryId;
          const maxSlots = totalRounds; // 6 picks per team
          const filledSlots = team.members.length;
          const emptySlots = Math.max(0, maxSlots - filledSlots);

          return (
            <div
              key={team.entryId}
              className={`rounded-lg border p-3 sm:p-4 transition-colors ${
                isCurrent
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                  : "border-[var(--color-border)] bg-[var(--color-panel)]"
              }`}
            >
              {/* 队名 + draft order */}
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-bold text-[var(--color-fg)] truncate">
                  {team.teamName}
                </h3>
                <span className="text-xs text-[var(--color-fg-dim)] tabular">
                  #{team.draftOrder}
                </span>
              </div>

              {/* 队长 */}
              <div className="text-xs mb-1">
                <span className="text-[var(--color-fg-dim)]">队长 </span>
                <span className="text-[var(--color-fg)] font-medium">
                  {getPublicDisplayName(team.captain)}
                </span>
                <span className="text-[var(--color-fg-dim)] ml-1">
                  {positionLabel(team.captain.primaryPosition)}
                </span>
              </div>

              {/* 已选队员 */}
              {team.members.map((m, index) => (
                <div key={`${team.entryId}-${m.pickNumber || index}`} className="text-xs mb-0.5">
                  <span className="text-[var(--color-fg-mid)]">
                    R{m.pickRound}P{m.pickNumber}{" "}
                  </span>
                  <span className="text-[var(--color-fg)]">{getPublicDisplayName(m)}</span>
                  <span className="text-[var(--color-fg-dim)] ml-1">
                    {positionLabel(m.primaryPosition)}
                  </span>
                  {m.autoPicked && (
                    <span className="text-[var(--color-warn)] ml-0.5">⚡</span>
                  )}
                </div>
              ))}

              {/* 空位 */}
              {Array.from({ length: emptySlots }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="text-xs text-[var(--color-fg-dim)] mb-0.5"
                >
                  ??? · ??? · 待选
                </div>
              ))}

              {/* 满员标记 */}
              {emptySlots === 0 && (
                <div className="text-xs text-[var(--color-ok)] mt-1">阵容已满</div>
              )}

              {isCurrent && (
                <div className="mt-2 text-xs font-medium text-[var(--color-accent)]">
                  第 {currentRound} 轮 · 选择中…
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
