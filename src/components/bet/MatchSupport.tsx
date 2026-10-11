import Link from "next/link";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { formatPoints } from "@/lib/bet/presentation";

export interface MatchSupportTeam {
  entryId: string;
  name: string;
}

export function MatchSupport({ slug, matchId, teamA, teamB, amounts }: {
  slug: string;
  matchId: string;
  teamA: MatchSupportTeam;
  teamB: MatchSupportTeam;
  amounts: { entryId: string; amount: string }[];
}) {
  const total = amounts.reduce((sum, row) => sum + BigInt(row.amount), BigInt(0));
  const a = amounts.find(row => row.entryId === teamA.entryId);
  const b = amounts.find(row => row.entryId === teamB.entryId);
  // A corrected matchup must not relabel a previous market's frozen teams.
  const available = total > BigInt(0) && a && b && BigInt(a.amount) + BigInt(b.amount) === total;
  const left = available ? Number((BigInt(a.amount) * BigInt(1000) + total / BigInt(2)) / total) / 10 : null;
  const right = left === null ? null : (1000 - Math.round(left * 10)) / 10;

  return <div className="min-w-0 space-y-3 border border-[var(--color-border)] bg-[var(--color-panel-low)] p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-5">
        <span className="relative inline-block font-mono font-bold text-[var(--color-accent)]">BET<HelpTooltip className="absolute -right-3 top-0" label="支持率说明" content="支持率按本场比赛胜者盘口中，各队投入积分占总投入积分计算，不代表获胜概率或支持人数比例。" /></span>
        <span className="text-[var(--color-fg-mid)]">奖池 {formatPoints(total.toString())}</span>
      </span>
      <Link href={`/${slug}/bet?match=${matchId}` as never} className="shrink-0 focus-visible:outline focus-visible:outline-[var(--color-accent)]">查看盘口 →</Link>
    </div>
    <div role="group" aria-label="比赛支持率" className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3 text-xs font-medium">
        <TeamProfileLink seasonSlug={slug} entryId={teamA.entryId} className="min-w-0 truncate text-[var(--color-accent)]" title={teamA.name}>{teamA.name}</TeamProfileLink>
        <TeamProfileLink seasonSlug={slug} entryId={teamB.entryId} className="min-w-0 truncate text-right text-[var(--color-accent-b)]" title={teamB.name}>{teamB.name}</TeamProfileLink>
      </div>
      <div className="flex items-center gap-3 font-mono text-xs tabular-nums" aria-label={left === null ? "暂无支持率数据" : `${teamA.name} ${left.toFixed(1)}%，${teamB.name} ${right!.toFixed(1)}%`}>
        <span className={left === null ? "text-[var(--color-fg-dim)]" : "text-[var(--color-accent)]"}>{left === null ? "—" : `${left.toFixed(1)}%`}</span>
        <div aria-hidden="true" className="flex h-1 min-w-0 flex-1 overflow-hidden bg-[var(--color-border)]">
          {left !== null && <><span className="h-full bg-[var(--color-accent)]" style={{ width: `${left}%` }} /><span className="h-full bg-[var(--color-accent-b)]" style={{ width: `${right}%` }} /></>}
        </div>
        <span className={right === null ? "text-[var(--color-fg-dim)]" : "text-[var(--color-accent-b)]"}>{right === null ? "—" : `${right.toFixed(1)}%`}</span>
      </div>
    </div>
  </div>;
}
