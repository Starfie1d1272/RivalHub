import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, and, or, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, users, seasonRegistrations, teamMembers } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

const FORMAT_LABELS = { bo1: "BO1", bo3: "BO3", bo5: "BO5" };
const STAGE_LABELS = { qualifier: "排位赛", playoff: "正赛" };
const SIDE_LABELS = { t: "T 方", ct: "CT 方" };

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
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          ← 返回赛程总览
        </Link>
        {match.stage === "playoff" && match.bracketNodeId && (
          <Link
            href={`/${seasonSlug}/matches#bracket`}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            查看对阵图 →
          </Link>
        )}
      </div>

      {/* 头部：比赛信息 */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[var(--text-secondary)]">
            {STAGE_LABELS[match.stage as keyof typeof STAGE_LABELS]}
          </Badge>
          <Badge variant="outline" className="text-[var(--text-secondary)]">
            {FORMAT_LABELS[match.format as keyof typeof FORMAT_LABELS]}
          </Badge>
          <MatchStatusBadge status={match.status as "scheduled" | "in_progress" | "finished" | "cancelled"} />
        </div>

        <div className="flex items-center justify-center gap-6 py-4">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {teamA?.name ?? "未知队伍"}
          </span>
          <div className="text-center">
            {isFinished ? (
              <span className="text-4xl font-mono font-bold text-[var(--primary)]">
                {match.scoreA ?? 0}&nbsp;:&nbsp;{match.scoreB ?? 0}
              </span>
            ) : (
              <span className="text-3xl font-bold text-[var(--text-secondary)]">vs</span>
            )}
          </div>
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {teamB?.name ?? "未知队伍"}
          </span>
        </div>
      </Card>

      {/* 单图结果 */}
      {maps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">地图结果</h2>
          <div className="space-y-2">
            {maps.map((map) => (
              <Card key={map.id} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-secondary)] w-5">
                      #{map.mapOrder}
                    </span>
                    <span className="font-medium text-[var(--text-primary)]">{map.mapName}</span>
                    {map.pickedByTeamId === match.teamAId && (
                      <Badge variant="outline" className="text-xs">
                        {teamA?.name} Pick
                      </Badge>
                    )}
                    {map.pickedByTeamId === match.teamBId && (
                      <Badge variant="outline" className="text-xs">
                        {teamB?.name} Pick
                      </Badge>
                    )}
                    {map.pickedByTeamId === null && (
                      <Badge variant="outline" className="text-xs text-[var(--text-secondary)]">
                        决胜图
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {map.teamAStartSide && (
                      <span className="text-[var(--text-secondary)]">
                        {teamA?.name} {SIDE_LABELS[map.teamAStartSide]}先
                      </span>
                    )}
                    {map.scoreA !== null && map.scoreB !== null && (
                      <span className="font-mono font-bold text-[var(--text-primary)]">
                        {map.scoreA}&nbsp;:&nbsp;{map.scoreB}
                      </span>
                    )}
                  </div>
                </div>
                {isFinished && (
                  <PlayerStatsTable matchId={match.id} mapId={map.id} />
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* 赛前名单 */}
      {match.status !== "finished" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            赛前名单
          </h2>
          <Card className="p-4">
            <MatchRosterView
              teamAName={teamA?.name ?? "队伍 A"}
              teamARoster={teamARoster}
              teamBName={teamB?.name ?? "队伍 B"}
              teamBRoster={teamBRoster}
            />
          </Card>
          {(isCaptainA || isCaptainB) && (
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-medium">提交名单</h3>
              <MatchRosterForm
                matchId={match.id}
                teamMembers={captainTeamMembers}
                hasExistingRoster={captainRoster?.status === "submitted"}
              />
            </Card>
          )}
        </section>
      )}

      {/* 比赛时间协商 */}
      {match.status === "scheduled" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            比赛时间协商
          </h2>
          <Card className="p-4 space-y-4">
            <MatchTimeNegotiation
              matchId={match.id}
              isCaptainA={isCaptainA}
              isCaptainB={isCaptainB}
              isAdmin={isSeasonAdmin}
              currentScheduledAt={match.scheduledAt}
              initialProposals={timeProposals}
            />
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-medium mb-2">协商历史</h3>
            <TimeProposalHistory proposals={timeProposals} />
          </Card>
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
