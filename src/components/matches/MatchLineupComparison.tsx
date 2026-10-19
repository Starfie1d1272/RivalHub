"use client";

import React, { useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { formatDisplayValue } from "@/lib/stats/display";
import { STATS_METRICS } from "@/lib/stats/metrics";
import { defaultLineupPlayer, type LineupCareer, type LineupPlayer } from "@/lib/matches/lineup-comparison";

interface Side {
  entryId: string;
  name: string;
  players: LineupPlayer[] | null;
  expected: boolean;
}
export interface MatchLineupComparisonProps {
  a: Side;
  b: Side;
  careers: LineupCareer[];
  historical: boolean;
  unavailable?: boolean;
}

const metrics = ["rating", "adr", "kpr", "kast", "firstKill", "trade"] as const;

function RosterSide({ side, selected, onSelect, careers, className }: {
  side: Side; selected: string | null; onSelect: (id: string) => void; careers: Map<string, LineupCareer>; className: string;
}) {
  const starters = side.players?.filter((player) => player.isStarter) ?? [];
  const subs = side.players?.filter((player) => !player.isStarter) ?? [];
  return <div className={`min-w-0 p-3 sm:p-4 ${className}`}>
    <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-1">
      <TeamProfileLink entryId={side.entryId} className="min-w-0 truncate text-sm font-semibold" title={side.name}>{side.name}</TeamProfileLink>
      <span className="text-xs text-[var(--color-fg-dim)]">{side.expected ? "预计阵容" : "本场首发"}</span>
    </div>
    <div className="space-y-1">
      {starters.map((player, index) => {
        const name = getPublicDisplayName(player);
        const career = player.userId ? careers.get(player.userId) : undefined;
        const active = Boolean(player.userId && player.userId === selected);
        return <div key={player.userId ?? index} className={`flex min-w-0 items-center rounded-sm border ${active ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-transparent hover:bg-[var(--color-panel-hi)]"}`}>
          <button type="button" disabled={!player.userId} aria-label={`选择 ${name}`} aria-pressed={active}
            onClick={() => player.userId && onSelect(player.userId)}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)]">
            <PlayerAvatar name={name} avatarUrl={player.avatarUrl} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={name}>{name}</span>
              <span className="block truncate text-xs text-[var(--color-fg-dim)]">{player.substituteAppearance ? "替补出场 · " : ""}{career ? `${career.maps} Maps` : "暂无记录"}</span>
            </span>
            {active && <Check className="hidden size-3 shrink-0 text-[var(--color-accent)] sm:block" aria-hidden="true" />}
          </button>
          {player.userId && <PlayerProfileLink userId={player.userId} aria-label={`${name} 的个人主页`} className="inline-flex min-h-11 w-7 shrink-0 items-center justify-center text-[var(--color-fg-dim)]"><ArrowUpRight className="size-3.5" aria-hidden="true" /></PlayerProfileLink>}
        </div>;
      })}
      {!starters.length && <p className="py-3 text-sm text-[var(--color-fg-dim)]">首发待定</p>}
    </div>
    {subs.length > 0 && <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-fg-dim)]">
      <span>替补</span>{subs.map((player, index) => player.userId
        ? <PlayerProfileLink key={player.userId} userId={player.userId}>{getPublicDisplayName(player)}</PlayerProfileLink>
        : <span key={index}>{getPublicDisplayName(player)}</span>)}
    </div>}
  </div>;
}

function SelectedPlayer({ player, career }: { player: LineupPlayer; career: LineupCareer }) {
  const name = getPublicDisplayName(player);
  return <div className="flex min-w-0 flex-col items-center gap-1 text-center">
    <PlayerAvatar name={name} avatarUrl={player.avatarUrl} size="md" />
    <PlayerProfileLink userId={career.userId} className="max-w-full truncate text-sm font-semibold" title={name}>{name}</PlayerProfileLink>
    <span className="text-xs text-[var(--color-fg-dim)]">{career.maps} Maps · {career.rounds ?? "—"} Rounds{!career.qualified && <span className="block">样本有限</span>}</span>
  </div>;
}

export function MatchLineupComparison({ a, b, careers, historical, unavailable }: MatchLineupComparisonProps) {
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const byUser = new Map(careers.map((career) => [career.userId, career]));
  // Keep an intentional selection across refreshes, and resolve replacements from the new lineup.
  const resolve = (side: Side, id: string | null) => side.players?.some((player) => player.isStarter && player.userId === id) ? id : defaultLineupPlayer(side.players ?? [], careers);
  const selectedA = resolve(a, aId);
  const selectedB = resolve(b, bId);
  const playerA = a.players?.find((player) => player.isStarter && player.userId === selectedA);
  const playerB = b.players?.find((player) => player.isStarter && player.userId === selectedB);
  const careerA = selectedA ? byUser.get(selectedA) : undefined;
  const careerB = selectedB ? byUser.get(selectedB) : undefined;
  const comparable = playerA && playerB && careerA && careerB
    && metrics.some((metric) => careerA[metric] !== null && careerB[metric] !== null);
  const hasHistory = careers.length > 0;

  return <div data-testid="match-lineup-comparison">
    <div className={`grid grid-cols-2 ${comparable ? "lg:grid-cols-[1fr_1.15fr_1fr]" : ""}`}>
      <RosterSide side={a} selected={selectedA} onSelect={setAId} careers={byUser} className="order-1" />
      {comparable && <div className="order-3 col-span-2 border-t border-[var(--color-border)] bg-[var(--color-panel-hi)] px-4 py-4 lg:order-2 lg:col-span-1 lg:border-x lg:border-t-0" aria-label="选手关键数据对比">
        <div className="mb-3 text-center font-mono text-xs font-semibold tracking-widest text-[var(--color-fg-mid)]">HIGHLIGHTED STATS</div>
        <div className="mb-3 grid grid-cols-2 gap-4"><SelectedPlayer player={playerA} career={careerA} /><SelectedPlayer player={playerB} career={careerB} /></div>
        <dl className="space-y-0.5">
          {metrics.map((metric) => <div key={metric} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-[var(--color-border)] py-1.5">
            <dd className={`text-center font-mono text-base font-semibold tabular-nums ${metric === "rating" ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"}`}>{formatDisplayValue(careerA[metric], STATS_METRICS[metric])}</dd>
            <dt className="relative min-w-20 text-center text-xs text-[var(--color-fg-mid)]">{STATS_METRICS[metric].label}<HelpTooltip label={`${STATS_METRICS[metric].label} 说明`} content={STATS_METRICS[metric].description} className="absolute -right-2 top-0.5" /></dt>
            <dd className={`text-center font-mono text-base font-semibold tabular-nums ${metric === "rating" ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"}`}>{formatDisplayValue(careerB[metric], STATS_METRICS[metric])}</dd>
          </div>)}
        </dl>
      </div>}
      <RosterSide side={b} selected={selectedB} onSelect={setBId} careers={byUser} className={`order-2 border-l border-[var(--color-border)] ${comparable ? "lg:order-3 lg:border-l-0" : ""}`} />
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
      <span className="relative pr-3">{historical ? "开赛前个人生涯" : "个人正式比赛生涯"}<HelpTooltip label="阵容对比数据范围" content="统计来自已结束的正式比赛；已开赛对阵仅使用开赛前结束的比赛。预计阵容为本届登记首发，提交本场名单后更新。样本有限的选手仍显示真实数值。" className="absolute right-0 top-0.5" /></span>
      {unavailable ? <span>统计暂不可用</span> : !comparable && hasHistory ? <span>所选阵容暂无双方可对照数据 · 可查看个人主页</span> : comparable ? <span>点击阵容切换选手</span> : null}
    </div>
  </div>;
}
