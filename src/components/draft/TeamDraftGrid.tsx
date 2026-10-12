"use client";

import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { positionLabel } from "@/lib/validators/registration";
import type { DraftTeamSlot } from "@/lib/draft/data";

interface TeamDraftGridProps {
  teams: DraftTeamSlot[];
  currentEntryId: string | null;
  totalRounds: number;
  currentRound: number;
  archive?: boolean;
  isActive?: boolean;
}

export function TeamDraftGrid({
  teams,
  currentEntryId,
  totalRounds,
  currentRound,
  archive = false,
  isActive = true,
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
          const emptySlots = archive ? 0 : Math.max(0, totalRounds - team.members.length);

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
                type="button"
                aria-expanded={isExpanded}
                aria-controls={`team-roster-${team.entryId}`}
                disabled={isCurrent}
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
                <span className="ml-2 flex shrink-0 items-center gap-2 font-mono text-xs text-[var(--color-fg-dim)]">
                  {team.members.length}/{totalRounds}
                  {!isCurrent && <ChevronDown className={`size-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />}
                </span>
              </button><TeamProfileLink entryId={team.entryId} variant="dense" className="px-3" aria-label={`查看 ${team.teamName} 队伍资料`}>查看队伍 ↗</TeamProfileLink>

              {/* 展开内容 */}
              {isExpanded && (
                <div id={`team-roster-${team.entryId}`} className="px-3 pb-3 space-y-1 border-t border-[var(--color-border)]">
                  {/* 队长行 */}
                  <div className="flex items-center justify-between py-1">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-fg-mid)]">
                      <span className="text-[var(--color-fg-dim)]">队长 </span>
                      {team.captain.userId ? <PlayerProfileLink userId={team.captain.userId} aria-label={getPublicDisplayName(team.captain)} className="inline-flex min-w-0 items-center gap-2"><PlayerAvatar name={getPublicDisplayName(team.captain)} avatarUrl={team.captain.avatarUrl} size="sm" /><span>{getPublicDisplayName(team.captain)}</span></PlayerProfileLink> : <><PlayerAvatar name={getPublicDisplayName(team.captain)} avatarUrl={team.captain.avatarUrl} size="sm" />{getPublicDisplayName(team.captain)}</>}
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
                      <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-fg)]">
                        <PlayerProfileLink userId={m.userId} aria-label={getPublicDisplayName(m)} className="inline-flex min-w-0 items-center gap-2"><PlayerAvatar name={getPublicDisplayName(m)} avatarUrl={m.avatarUrl} size="sm" /><span>{getPublicDisplayName(m)}</span></PlayerProfileLink>
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
                      第 {currentRound} 轮 · {isActive ? "选择中…" : "等待恢复"}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-4 min-[112.5rem]:grid-cols-8">
        {sorted.map(team => <section key={team.entryId} className={`min-w-0 overflow-hidden rounded-[var(--radius-md)] border ${team.entryId === currentEntryId ? "border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] bg-[var(--color-panel)]"}`}>
          <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-3"><h3 className="min-w-0 truncate font-semibold"><TeamProfileLink entryId={team.entryId}>{team.teamName}</TeamProfileLink></h3><span className="font-mono text-xs text-[var(--color-fg-mid)]">{String(team.draftOrder).padStart(2, "0")}</span></header>
          <div className="space-y-1 px-3 py-3 min-[112.5rem]:space-y-2">
            <div className="border-b border-[var(--color-border)] pb-3"><p className="mb-1 text-xs text-[var(--color-accent)]">队长 · {positionLabel(team.captain.primaryPosition)}</p><p className="truncate text-sm font-medium">{team.captain.userId ? <PlayerProfileLink userId={team.captain.userId}>{getPublicDisplayName(team.captain)}</PlayerProfileLink> : getPublicDisplayName(team.captain)}</p></div>
            {team.members.map(member => <div key={member.userId} className="flex min-h-8 min-[112.5rem]:min-h-9 min-w-0 items-center gap-2 text-sm"><span className="w-5 shrink-0 font-mono text-xs text-[var(--color-fg-mid)]">R{member.pickRound}</span><PlayerProfileLink userId={member.userId} className="min-w-0 flex-1 truncate">{getPublicDisplayName(member)}</PlayerProfileLink><span className="shrink-0 text-xs text-[var(--color-fg-mid)]" title={positionLabel(member.primaryPosition)}>{positionLabel(member.primaryPosition)}</span>{member.autoPicked && <span title="自动选人" className="text-[var(--color-warn)]">⚡</span>}</div>)}
            {!archive && Array.from({ length: Math.max(0, totalRounds - team.members.length) }, (_, index) => <div key={index} className="flex min-h-8 min-[112.5rem]:min-h-9 items-center gap-2 border-t border-dashed border-[var(--color-border)] text-xs text-[var(--color-fg-mid)]"><span className="w-5 font-mono">R{team.members.length + index + 1}</span>待选</div>)}
          </div>
        </section>)}
      </div>
    </>
  );
}
