import Link from "next/link";
import React from "react";
import { cn } from "@/lib/utils/cn";
import { presentMatchFormat, presentMatchLabel } from "@/lib/matches/presentation";
import { Panel, StatusPill } from "@/components/rivalhub";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import type { AdminMatchSummary } from "@/lib/admin/matches/types";
import { formatCSTDateTime } from "@/lib/utils/date";

export interface AdminMatchRowProps {
  match: AdminMatchSummary;
  teamAName: string;
  teamBName: string;
  seasonSlug: string;
  stageName?: string | null;
}

/**
 * Lightweight season-level match summary. Operational detail is deliberately
 * linked to the match workbench instead of being rendered in every row.
 */
export function AdminMatchRow({
  match,
  teamAName,
  teamBName,
  seasonSlug,
  stageName,
}: AdminMatchRowProps) {
  return (
    <Panel
      contentClassName="p-4"
      className={cn(
        "space-y-3",
        match.status === "in_progress" && "border-l-[3px] border-[var(--color-accent)]",
      )}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{teamAName}</span>
          <span className="text-[var(--color-fg-mid)]">
            {match.status === "finished" ? `${match.scoreA ?? 0} : ${match.scoreB ?? 0}` : "vs"}
          </span>
          <span className="font-semibold">{teamBName}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill {...presentMatchFormat(match.format)} />
          <MatchStatusBadge
            status={match.status}
            isForfeit={match.isForfeit}
            scheduledAt={match.scheduledAt}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
        <span className="font-mono">比赛 ID：{match.id}</span>
        <span>
          {presentMatchLabel({
            stage: match.stage,
            stageName,
            round: match.round,
            entryRound: match.entryRound,
            teamAName,
            teamBName,
          })}
        </span>
        <span>{match.scheduledAt ? `排期：${formatCSTDateTime(match.scheduledAt)}` : "尚未排期"}</span>
        {match.ownership === "major_stage" ? <span>Major runtime 管理</span> : <span>手动比赛</span>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
        <p className="text-xs text-[var(--color-fg-mid)]">
          首发、BP、结果、赛后资料与恢复操作均在单场工作台完成。
        </p>
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/${seasonSlug}/matches/${match.id}`}
            className="text-sm font-medium text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            进入比赛工作台 →
          </Link>
          <Link
            href={`/${seasonSlug}/matches/${match.id}`}
            className="text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            target="_blank"
            rel="noreferrer"
          >
            查看公开页 ↗
          </Link>
        </div>
      </div>
    </Panel>
  );
}
