import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import type { MatchStatus } from "@/types/match";
import React from "react";
import Link from "next/link";
import type { RegistrationMode, SeasonStatus } from "@/types/season";
import { formatCSTDateTime } from "@/lib/utils/date";
import {
  getSeasonLifecycleGroup,
  isRegistrationActuallyOpen,
  presentSeasonLifecycle,
  presentSeasonLifecycleSummary,
  presentSeasonKind,
  presentRegistrationSchedule,
  presentSeasonParticipationState,
} from "@/lib/seasons/presentation";
import { MiniStat, Panel, StatusPill } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";

export { shouldLoadRegistrationPositionCounts } from "@/lib/home/presentation";

interface HomePanelSeason {
  name: string;
  hasOfficialMatches?: boolean;
  slug: string;
  status: SeasonStatus;
  registrationMode: RegistrationMode;
  kind: string;
  positions: string[];
  registrationOpensAt: Date | null;
  registrationOpenedAt: Date | null;
  registrationClosesAt: Date | null;
}

interface CandidateSummary {
  userId?: string;
  name: string;
  voteCount: number;
}

interface HomeMatchSummary {
  teamAName?: string | null;
  teamBName?: string | null;
  id: string;
  entryAId?: string | null;
  entryBId?: string | null;
  status: string;
  scheduledAt: Date | null;
  format: string;
}

interface HomeSeasonPanelProps {
  season: HomePanelSeason;
  maxPerPosition: number;
  positionCountMap: Map<string, number>;
  topCandidatesWithNames: CandidateSummary[];
  liveAndUpcomingMatches: HomeMatchSummary[];
  teamCount: number;
  playerCount: number;
}

export function HomeSeasonPanel({
  season,
  maxPerPosition,
  positionCountMap,
  topCandidatesWithNames,
  liveAndUpcomingMatches,
  teamCount,
  playerCount,
}: HomeSeasonPanelProps) {
  const registrationSchedule = presentRegistrationSchedule(season);
  if (isRegistrationActuallyOpen(season) && !season.hasOfficialMatches && liveAndUpcomingMatches.length === 0) {
    return (
      <Panel label="REGISTRATION">
        <div className="grid gap-3.5">
          <SeasonPanelTitle season={season} />
          {registrationSchedule && (
            <p className="text-sm text-[var(--color-fg-mid)]">
              {registrationSchedule.primary}{season.registrationMode === "team" && registrationSchedule.secondary ? ` · ${registrationSchedule.secondary}` : ""}
            </p>
          )}
          {season.registrationMode === "team" ? (
            <div className="py-3 border-y border-[var(--color-border)]">
              <PanelStats teamCount={teamCount} playerCount={playerCount} status={season.status} registrationMode={season.registrationMode} />
            </div>
          ) : (
            <div className="grid gap-2">
              {season.positions.map((pos) => {
                const filled = positionCountMap.get(pos) ?? 0;
                const pct = maxPerPosition > 0
                  ? Math.min(100, Math.round((filled / maxPerPosition) * 100))
                  : 0;

                return (
                  <div key={pos}>
                    <div className="flex justify-between mb-1" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                      <span className="uppercase">{pos}</span>
                      <span style={{ color: "var(--color-fg-mid)" }}>{filled} / {maxPerPosition}</span>
                    </div>
                    <div className="h-[3px] rounded-full" style={{ background: "var(--color-border)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: pct >= 90 ? "var(--color-warn)" : "var(--color-accent)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {season.registrationMode === "team" && <Button variant="outline" asChild><Link href="/teams/recruitment">去组队大厅找队友 →</Link></Button>}
        </div>
      </Panel>
    );
  }

  if (season.status === "voting" && liveAndUpcomingMatches.length === 0) {
    return (
      <Panel label="VOTING · TOP 3">
        <div className="grid gap-3">
          {topCandidatesWithNames.length > 0 ? (
            topCandidatesWithNames.map((candidate, index) => (
              <CandidateRankRow
                key={`${candidate.name}-${index}`}
                candidate={candidate}
                index={index}
              />
            ))
          ) : (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-dim)" }}>
              暂无投票数据
            </div>
          )}
        </div>
        <Button className="mt-3.5 w-full" asChild>
          <Link href={`/${season.slug}/captains`} className="w-full">
            查看全部候选人 →
          </Link>
        </Button>
      </Panel>
    );
  }

  if (season.status === "drafting" && liveAndUpcomingMatches.length === 0) {
    return <Panel label="DRAFT"><SeasonPanelTitle season={season} /><p className="my-4 text-sm text-[var(--color-fg-mid)]">关注选人进度与正在形成的赛事阵容。</p><Button asChild><Link href={`/${season.slug}/draft`}>查看选秀 →</Link></Button></Panel>;
  }

  if (season.status === "playing" || liveAndUpcomingMatches.length > 0) {
    return (
      <Panel label="近期比赛">
        <div className="grid gap-3.5">
          <div className="grid gap-2 py-3 border-y border-[var(--color-border)]">
            {liveAndUpcomingMatches.length > 0 ? (
              liveAndUpcomingMatches.map((match) => (
                <MatchTickerRow key={match.id} match={match} slug={season.slug} />
              ))
            ) : (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-dim)" }}>
                待进行比赛尚未排定
              </div>
            )}
          </div>
          <Button className="w-full" asChild>
            <Link href={`/${season.slug}/matches`} className="w-full">
              查看赛程 →
            </Link>
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel label={getSeasonLifecycleGroup(season) === "upcoming" ? "UPCOMING" : "EVENT"}>
      <div className="grid gap-3.5">
        <SeasonPanelTitle season={season} useLifecycleSummary />
        <div className="flex items-center gap-2">
          <StatusPill {...presentSeasonLifecycle(season)} />
          <span className="text-xs text-[var(--color-fg-mid)]">{presentSeasonLifecycleSummary(season)}</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {presentSeasonKind(season.kind)}
          </span>
        </div>
        {registrationSchedule && (
          <p className="text-sm text-[var(--color-fg-mid)]">
            {registrationSchedule.primary}{registrationSchedule.secondary ? ` · ${registrationSchedule.secondary}` : ""}
          </p>
        )}
        <div className="py-3 border-y border-[var(--color-border)]">
          <PanelStats teamCount={teamCount} playerCount={playerCount} status={season.status} registrationMode={season.registrationMode} />
        </div>
        <Button className="w-full" asChild>
          <Link href={`/${season.slug}`} className="w-full">
            进入赛事 →
          </Link>
        </Button>
      </div>
    </Panel>
  );
}

function SeasonPanelTitle({ season, useLifecycleSummary = false }: { season: HomePanelSeason; useLifecycleSummary?: boolean }) {
  const label = useLifecycleSummary
    ? presentSeasonLifecycleSummary(season)
    : presentSeasonParticipationState(season).label;

  return (
    <div>
      <div
        className="uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--color-fg-dim)",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {label}
      </div>
      <div
        className="mt-1 font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          color: "var(--color-fg)",
        }}
      >
        {season.name}
      </div>
    </div>
  );
}

function CandidateRankRow({
  candidate,
  index,
}: {
  candidate: CandidateSummary;
  index: number;
}) {
  return (
    <div
      className="grid items-center gap-3"
      style={{
        gridTemplateColumns: "auto 1fr auto",
        padding: "10px 12px",
        background: index === 0 ? "color-mix(in srgb, var(--color-accent) 4%, transparent)" : "var(--color-panel-low)",
        border: `1px solid ${index === 0 ? "var(--color-accent-edge)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-sm, 2px)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 20,
          fontWeight: 700,
          color: index === 0 ? "var(--color-accent)" : "var(--color-fg-mid)",
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--color-fg)" }}>
          {candidate.userId ? <PlayerProfileLink userId={candidate.userId}>{candidate.name}</PlayerProfileLink> : candidate.name}
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--color-fg)",
        }}
      >
        {candidate.voteCount}
      </div>
    </div>
  );
}

function MatchTickerRow({ match, slug }: { match: HomeMatchSummary; slug: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {(match.teamAName || match.teamBName) && <span className="min-w-0 break-words text-sm [overflow-wrap:anywhere]"><TeamProfileLink seasonSlug={slug} entryId={match.entryAId}>{match.teamAName ?? "待定"}</TeamProfileLink> <span className="text-[var(--color-fg-mid)]">vs</span> <TeamProfileLink seasonSlug={slug} entryId={match.entryBId}>{match.teamBName ?? "待定"}</TeamProfileLink></span>}
        <MatchStatusBadge status={match.status as MatchStatus} scheduledAt={match.scheduledAt} />
      </div>
      <Link href={`/${slug}/matches/${match.id}`} aria-label={`查看 ${match.teamAName ?? "待定"} 对 ${match.teamBName ?? "待定"} 比赛`} className="shrink-0 font-mono text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">
        {match.format.toUpperCase()}
        {match.scheduledAt
          ? ` · ${formatCSTDateTime(match.scheduledAt)}`
          : ""} →
      </Link>
    </div>
  );
}

function PanelStats({
  teamCount,
  playerCount,
  status,
  registrationMode,
}: {
  teamCount: number;
  playerCount: number;
  registrationMode: string;
  status: SeasonStatus;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label={registrationMode === "team" && status === "registration" ? "已通过审核" : "TEAMS"} value={teamCount} />
      <MiniStat label="PLAYERS" value={playerCount} accent />
    </div>
  );
}
