import React from "react";
import Link from "next/link";
import type { SeasonStatus } from "@/types/season";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { Btn, MiniStat, Panel, StatusPill } from "@/components/rivalhub";

interface HomePanelSeason {
  name: string;
  slug: string;
  status: SeasonStatus;
  kind: string;
  positions: string[];
}

interface CandidateSummary {
  name: string;
  voteCount: number;
}

interface HomeMatchSummary {
  id: string;
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
  if (season.status === "registration") {
    return (
      <Panel label="REGISTRATION">
        <div className="grid gap-3.5">
          <SeasonPanelTitle season={season} />
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
          <Btn full asChild>
            <Link href={`/${season.slug}/register`} className="w-full">
              立即报名 →
            </Link>
          </Btn>
        </div>
      </Panel>
    );
  }

  if (season.status === "voting") {
    return (
      <Panel label="投票排行 · TOP 3">
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
        <Btn full asChild style={{ marginTop: 14 }}>
          <Link href={`/${season.slug}/captains`} className="w-full">
            查看全部候选人 →
          </Link>
        </Btn>
      </Panel>
    );
  }

  if (season.status === "playing") {
    return (
      <Panel label="LIVE MATCHES">
        <div className="grid gap-3.5">
          <SeasonPanelTitle season={season} />
          <div className="grid gap-2 py-3 border-y border-[var(--color-border)]">
            {liveAndUpcomingMatches.length > 0 ? (
              liveAndUpcomingMatches.map((match) => (
                <MatchTickerRow key={match.id} match={match} />
              ))
            ) : (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-dim)" }}>
                暂无进行中的比赛
              </div>
            )}
          </div>
          <PanelStats teamCount={teamCount} playerCount={playerCount} status={season.status} />
          <Btn full asChild>
            <Link href={`/${season.slug}/matches`} className="w-full">
              查看赛程 →
            </Link>
          </Btn>
        </div>
      </Panel>
    );
  }

  return (
    <Panel label="CURRENT SEASON">
      <div className="grid gap-3.5">
        <SeasonPanelTitle season={season} />
        <div className="flex items-center gap-2">
          <StatusPill status={season.status} />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {season.kind}
          </span>
        </div>
        <div className="py-3 border-y border-[var(--color-border)]">
          <PanelStats teamCount={teamCount} playerCount={playerCount} status={season.status} />
        </div>
        <Btn full asChild>
          <Link href={`/${season.slug}`} className="w-full">
            进入赛季 →
          </Link>
        </Btn>
      </div>
    </Panel>
  );
}

function SeasonPanelTitle({ season }: { season: HomePanelSeason }) {
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
        {SEASON_STATUS_LABELS[season.status]}
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
        background: index === 0 ? "rgba(255,107,26,0.04)" : "var(--color-panel-low)",
        border: `1px solid ${index === 0 ? "rgba(255,107,26,0.27)" : "var(--color-border)"}`,
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
          {candidate.name}
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

function MatchTickerRow({ match }: { match: HomeMatchSummary }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {match.status === "in_progress" && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--color-ok)",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            ● LIVE
          </span>
        )}
        {match.status === "scheduled" && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--color-fg-dim)",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            NEXT
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-fg-mid)",
        }}
      >
        {match.format.toUpperCase()}
        {match.scheduledAt
          ? ` · ${new Date(match.scheduledAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : ""}
      </span>
    </div>
  );
}

function PanelStats({
  teamCount,
  playerCount,
  status,
}: {
  teamCount: number;
  playerCount: number;
  status: SeasonStatus;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <MiniStat label="TEAMS" value={teamCount} />
      <MiniStat label="PLAYERS" value={playerCount} accent />
      <MiniStat label="STAGE" value={status.toUpperCase()} />
    </div>
  );
}
