import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, and, or, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, users, seasonRegistrations, teamMembers } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";
import { Panel, PosChip, TeamBadge } from "@/components/rivalhub";
import { MATCH_FORMAT_LABELS, MATCH_STAGE_LABELS } from "@/types/match";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
import { TimeProposalHistory } from "@/components/matches/TimeProposalHistory";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
import { MatchRosterView } from "@/components/matches/MatchRosterView";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";
import { getMatchMvpResults } from "@/actions/player-stats";
import { getTimeProposals } from "@/actions/matches/scheduling";
import { getMatchRoster } from "@/actions/matches/roster";
import { getUserSession } from "@/lib/auth/session";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

const SIDE_LABELS = { t: "T 方", ct: "CT 方" };

const TEAM_COLORS = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];

function teamBadgeData(name: string, idx: number): { tag: string; color: string } {
  return { tag: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[idx % TEAM_COLORS.length] };
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });
  if (!match || match.seasonId !== season.id) notFound();

  const [teamA, teamB, maps] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
    db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
    db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, matchId),
      orderBy: (t, { asc }) => [asc(t.mapOrder)],
    }),
  ]);

  const isFinished = match.status === "finished";

  // ── 时间协商、名单、session（并行）────────────────────────────
  const [timeProposals, rosterA, rosterB, userSession] = await Promise.all([
    getTimeProposals(match.id),
    getMatchRoster(match.id, match.teamAId),
    getMatchRoster(match.id, match.teamBId),
    getUserSession(),
  ]);

  // ── MVP 投票数据 ──────────────────────────────────────────────
  let mvpCandidates: {
    userId: string | null;
    perfectName: string;
    ratingPro: number | null;
  }[] = [];
  let mvpVoteResults: Awaited<ReturnType<typeof getMatchMvpResults>> = [];
  let userVoted: string | null = null;

  if (isFinished) {
    const allStats = await db.query.matchPlayerStats.findMany({
      where: eq(matchPlayerStats.matchId, match.id),
    });

    const seen = new Set<string>();
    mvpCandidates = allStats
      .filter((s) => {
        const key = s.userId ?? s.perfectName;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((s) => ({
        userId: s.userId,
        perfectName: s.perfectName,
        ratingPro: s.ratingPro,
      }));

    mvpVoteResults = await getMatchMvpResults(match.id);

    if (userSession?.userId) {
      const existingVote = await db.query.matchMvpVotes.findFirst({
        where: and(
          eq(matchMvpVotes.matchId, match.id),
          eq(matchMvpVotes.voterUserId, userSession.userId),
        ),
      });
      if (existingVote) userVoted = existingVote.playerName;
    }
  }

  // ── 团队人员数据（一次性查询，供队长检测 + 名单视图共用）──
  const allTeamMembers = await db
    .select({
      id: teamMembers.id,
      teamId: teamMembers.teamId,
      steamName: users.steamName,
      primaryPosition: seasonRegistrations.primaryPosition,
    })
    .from(teamMembers)
    .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(
      inArray(teamMembers.teamId, [match.teamAId, match.teamBId]),
    );

  // ── 队长身份与管理员检测 ─────────────────────────────────────
  let isCaptainA = false;
  let isCaptainB = false;
  let isSeasonAdmin = false;
  let captainTeamMembers: { id: string; steamName: string; primaryPosition: string }[] = [];

  if (userSession?.userId) {
    isSeasonAdmin =
      userSession.role === "super_admin" ||
      (userSession.role === "season_admin" &&
        userSession.adminSeasonIds.includes(season.id));

    const reg = await db.query.seasonRegistrations.findFirst({
      where: and(
        eq(seasonRegistrations.userId, userSession.userId),
        eq(seasonRegistrations.seasonId, season.id),
      ),
    });
    if (reg) {
      isCaptainA = teamA?.captainRegistrationId === reg.id;
      isCaptainB = teamB?.captainRegistrationId === reg.id;

      if (isCaptainA || isCaptainB) {
        const captainTeamId = isCaptainA ? match.teamAId : match.teamBId;
        captainTeamMembers = allTeamMembers
          .filter((m) => m.teamId === captainTeamId)
          .map((r) => ({
            id: r.id,
            steamName: r.steamName ?? "未知",
            primaryPosition: r.primaryPosition,
          }));
      }
    }
  }

  // ── 名单视图数据 ────────────────────────────────────────────
  interface RosterPlayer {
    steamName: string;
    primaryPosition: string;
    isStarter: boolean;
  }

  function buildRoster(
    roster: NonNullable<Awaited<ReturnType<typeof getMatchRoster>>>,
    members: typeof allTeamMembers,
    teamId: string,
  ): RosterPlayer[] {
    const playerMap = new Map(roster.players.map((p) => [p.teamMemberId, p.isStarter]));
    const playerIds = new Set(roster.players.map((p) => p.teamMemberId));
    return members
      .filter((m) => m.teamId === teamId && playerIds.has(m.id))
      .map((m) => ({
        steamName: m.steamName ?? "未知",
        primaryPosition: m.primaryPosition,
        isStarter: playerMap.get(m.id) ?? false,
      }));
  }

  const captainRoster = isCaptainA ? rosterA : isCaptainB ? rosterB : null;
  const teamARoster: RosterPlayer[] | null = rosterA
    ? buildRoster(rosterA, allTeamMembers, match.teamAId)
    : null;
  const teamBRoster: RosterPlayer[] | null = rosterB
    ? buildRoster(rosterB, allTeamMembers, match.teamBId)
    : null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-8">
      {/* 导航 */}
      <div className="flex items-center gap-4">
        <Link
          href={`/${seasonSlug}/matches`}
          className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← 返回赛程总览
        </Link>
        {match.stage === "playoff" && match.bracketNodeId && (
          <Link
            href={`/${seasonSlug}/matches#bracket`}
            className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
          >
            查看对阵图 →
          </Link>
        )}
      </div>

      {/* Hero header */}
      <div
        className="grid items-center gap-6 px-8 py-8 border-b"
        style={{
          gridTemplateColumns: "1fr auto 1fr",
          background: teamA && teamB
            ? `linear-gradient(90deg, ${teamBadgeData(teamA.name, 0).color}15 0%, transparent 35%, transparent 65%, ${teamBadgeData(teamB.name, 1).color}15 100%)`
            : `var(--color-panel-low)`,
          borderColor: "var(--color-border)",
          borderRadius: "var(--radius-lg)",
          border: `1px solid var(--color-border)`,
        }}
      >
        {/* Team A */}
        <div className="flex items-center gap-4 justify-end">
          <div className="text-right min-w-0">
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamA?.name ?? "未知队伍"}
            </div>
          </div>
          {teamA && <TeamBadge team={teamBadgeData(teamA.name, 0)} size={64} />}
        </div>

        {/* Score / VS */}
        <div className="text-center px-4">
          {match.status === "in_progress" && (
            <div
              className="inline-block mb-2 px-2.5 py-0.5 rounded-sm font-bold"
              style={{
                background: "var(--color-danger)",
                color: "var(--color-accent-fg)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "var(--tracking-label)",
              }}
            >
              ● LIVE
            </div>
          )}
          {isFinished ? (
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 56,
                color: "var(--color-fg)",
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}
            >
              {match.scoreA ?? 0}
              <span className="mx-3" style={{ color: "var(--color-fg-dim)", fontSize: 24 }}>:</span>
              {match.scoreB ?? 0}
            </div>
          ) : (
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 42,
                color: "var(--color-fg-dim)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              VS
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
            <PosChip pos={MATCH_STAGE_LABELS[match.stage] ?? match.stage} />
            <PosChip pos={MATCH_FORMAT_LABELS[match.format] ?? match.format} />
            <MatchStatusBadge status={match.status as "scheduled" | "in_progress" | "finished" | "cancelled"} />
          </div>
        </div>

        {/* Team B */}
        <div className="flex items-center gap-4">
          {teamB && <TeamBadge team={teamBadgeData(teamB.name, 1)} size={64} />}
          <div className="min-w-0">
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamB?.name ?? "未知队伍"}
            </div>
          </div>
        </div>
      </div>

      {/* 单图结果 */}
      {maps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">地图结果</h2>
          <div className="space-y-2">
            {maps.map((map) => (
              <Panel key={map.id} pad={16}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--color-fg-mid)] w-5">
                      #{map.mapOrder}
                    </span>
                    <span className="font-medium text-[var(--color-fg)]">{map.mapName}</span>
                    {map.pickedByTeamId === match.teamAId && (
                      <PosChip pos={`${teamA?.name} Pick`} />
                    )}
                    {map.pickedByTeamId === match.teamBId && (
                      <PosChip pos={`${teamB?.name} Pick`} />
                    )}
                    {map.pickedByTeamId === null && (
                      <PosChip pos="决胜图" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {map.teamAStartSide && (
                      <span className="text-[var(--color-fg-mid)]">
                        {teamA?.name} {SIDE_LABELS[map.teamAStartSide]}先
                      </span>
                    )}
                    {map.scoreA !== null && map.scoreB !== null && (
                      <span className="font-mono font-bold text-[var(--color-fg)]">
                        {map.scoreA}&nbsp;:&nbsp;{map.scoreB}
                      </span>
                    )}
                  </div>
                </div>
                {isFinished && (
                  <PlayerStatsTable matchId={match.id} mapId={map.id} />
                )}
              </Panel>
            ))}
          </div>
        </section>
      )}

      {/* 赛前名单 */}
      {match.status !== "finished" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">
            赛前名单
          </h2>
          <Panel pad={16}>
            <MatchRosterView
              teamAName={teamA?.name ?? "队伍 A"}
              teamARoster={teamARoster}
              teamBName={teamB?.name ?? "队伍 B"}
              teamBRoster={teamBRoster}
            />
          </Panel>
          {(isCaptainA || isCaptainB) && (
            <Panel pad={16}>
              <h3 className="text-sm font-medium">提交名单</h3>
              <MatchRosterForm
                matchId={match.id}
                teamMembers={captainTeamMembers}
                hasExistingRoster={captainRoster?.status === "submitted"}
              />
            </Panel>
          )}
        </section>
      )}

      {/* 比赛时间协商 */}
      {match.status === "scheduled" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">
            比赛时间协商
          </h2>
          <Panel pad={16}>
            <MatchTimeNegotiation
              matchId={match.id}
              isCaptainA={isCaptainA}
              isCaptainB={isCaptainB}
              isAdmin={isSeasonAdmin}
              currentUserId={userSession?.userId}
              currentScheduledAt={match.scheduledAt}
              currentCompletionDeadline={match.completionDeadline}
              initialProposals={timeProposals}
            />
          </Panel>
          <Panel pad={16}>
            <h3 className="text-sm font-medium mb-2">协商历史</h3>
            <TimeProposalHistory proposals={timeProposals} />
          </Panel>
        </section>
      )}

      {/* MVP 投票 */}
      {isFinished && mvpCandidates.length > 0 && (
        <MatchMvpVote
          matchId={match.id}
          candidates={mvpCandidates}
          currentVotes={mvpVoteResults}
          userVotedPlayerName={userVoted}
        />
      )}
    </div>
  );
}
