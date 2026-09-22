import React from "react";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { mapLabel } from "@/lib/maps";
import { formatStat } from "@/lib/stats";

interface PlayerPreview {
  name: string;
  avatarUrl: string | null;
  isStarter: boolean;
  userId?: string | null;
}

interface TeamCardProps {
  entryId: string;
  teamName: string;
  seasonSlug: string;
  eyebrow: string;
  logoUrl?: string | null;
  players: PlayerPreview[];
  record?: {
    played: number;
    wins: number;
    losses: number;
    winRate: string;
  };
  placement?: string;
  stages?: string[];
  maps?: { mapName: string; wins: number; played: number }[];
  summary?: {
    maps: number;
    avgRating: number | null;
    avgAdr: number | null;
  } | null;
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-2">
      <p className="text-[10px] uppercase text-[var(--color-fg-dim)]" style={{ fontFamily: "var(--font-mono)" }}>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-[var(--color-fg)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
    </div>
  );
}

export function TeamCard({
  entryId,
  teamName,
  seasonSlug,
  eyebrow,
  logoUrl,
  players,
  record,
  summary,
  placement,
  stages,
  maps,
}: TeamCardProps) {
  const starters = players.filter((p) => p.isStarter);
  const subs = players.filter((p) => !p.isStarter);

  return (
    <Panel className="h-full hover:border-[var(--color-border-hi)] transition-colors">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/${seasonSlug}/teams/${entryId}`} className="group flex min-w-0 items-center gap-3">
            <TeamLogo logoUrl={logoUrl ?? null} teamName={teamName} />
            <div className="min-w-0">
              <span className="text-xs text-[var(--color-fg-mid)]">{eyebrow}</span>
              <h3 className="font-bold text-lg text-[var(--color-fg)] leading-tight break-words group-hover:text-[var(--color-accent)] transition-colors">
                {teamName}
              </h3>
            </div>
          </Link>

          {record && (
            <div className="shrink-0 text-right">
              <p className="text-base font-black text-[var(--color-fg)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {record.wins}-{record.losses}
              </p>
              <p className="text-[10px] uppercase text-[var(--color-fg-mid)]" style={{ fontFamily: "var(--font-mono)" }}>
                {record.played > 0 ? `胜率 ${record.winRate}` : "暂无赛果"}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
          <span>{starters.length} 首发</span>
          {subs.length > 0 && <span>{subs.length} 替补</span>}
        </div>

        {stages && stages.length > 0 && <p className="text-xs text-[var(--color-fg-mid)]">已参赛 · {stages.join(" / ")}</p>}
        {placement && <p className="text-sm font-semibold text-[var(--color-accent)]">{placement}</p>}
        {maps && <div className="text-xs text-[var(--color-fg-mid)]"><p className="mb-1">本届正式地图表现</p>{maps.length ? <div className="flex flex-wrap gap-3">{maps.slice(0, 3).map((map) => <span key={map.mapName}>{mapLabel(map.mapName)} · {map.wins} 胜 {map.played - map.wins} 负</span>)}</div> : <Link href={`/${seasonSlug}/teams/${entryId}`}>暂无队伍样本 · 查看阵容地图经验 →</Link>}</div>}

        {summary && <div className="grid grid-cols-3 gap-2">
          <SummaryStat label="地图" value={summary?.maps ?? "—"} />
          <SummaryStat label="Rating" value={formatStat("ratingPro", summary?.avgRating)} />
          <SummaryStat label="ADR" value={formatStat("adr", summary?.avgAdr)} />
        </div>}

        <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          {starters.map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                {p.userId ? (
                  <Link href={`/players/${p.userId}`} className="text-sm text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors truncate">
                    {p.name}
                  </Link>
                ) : (
                  <span className="text-sm text-[var(--color-fg)] truncate">{p.name}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {subs.length > 0 && (
          <div className="border-t border-[var(--color-border)] pt-2 flex flex-wrap gap-x-3 gap-y-1 opacity-70">
            {subs.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-mid)]">
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                {p.userId ? (
                  <Link href={`/players/${p.userId}`} className="hover:text-[var(--color-accent)] transition-colors">
                    {p.name}
                  </Link>
                ) : (
                  p.name
                )}
                <span className="text-[10px] text-[var(--color-fg-dim)]">替补</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
