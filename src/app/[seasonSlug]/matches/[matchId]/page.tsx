import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { eq, and, or, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, users, seasonRegistrations, teamMembers } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";
import { Panel, PosChip, TeamBadge } from "@/components/rivalhub";
import { mapLabel } from "@/lib/maps";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MATCH_FORMAT_LABELS, MATCH_STAGE_LABELS, SIDE_LABELS } from "@/types/match";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { TimeProposalHistory } from "@/components/matches/TimeProposalHistory";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
import { MatchRosterView } from "@/components/matches/MatchRosterView";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";
import { VetoView } from "@/components/matches/VetoView";
import { MapPoolRadarChart } from "@/components/matches/MapPoolRadarChart";
import { MatchLineupsH2H } from "@/components/matches/MatchLineupsH2H";
import { TeamStatsCompare } from "@/components/matches/TeamStatsCompare";
import { MatchHeadToHead } from "@/components/matches/MatchHeadToHead";
import { MatchSummaryStats } from "@/components/matches/MatchSummaryStats";
import { getMatchMvpResults, ensureMvpWinner } from "@/actions/player-stats";
import { getTimeProposals } from "@/actions/matches/scheduling";
import { getMatchRoster } from "@/actions/matches/roster";
import { sumNums, avgNums, weightedAvgNums } from "@/lib/utils/stats";
import { getUserSession } from "@/lib/auth/session";
import { formatCSTDateTime } from "@/lib/utils/date";
import { normalizeRegistrationConfig } from "@/types/season";
import { getTeamMapWinStats, getTeamPickStats, getTeamBanStats, type MapWinStats } from "@/lib/teams/data";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

type MPS = typeof matchPlayerStats.$inferSelect;

const TEAM_COLORS = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];

function teamBadgeData(name: string, idx: number): { tag: string; color: string } {
  return { tag: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[idx % TEAM_COLORS.length] };
}

function computeRecord(
  teamId: string,
  matchList: { teamAId: string; teamBId: string; scoreA: number | null; scoreB: number | null }[],
): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const m of matchList) {
    const isA = m.teamAId === teamId;
    const myScore = isA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const oppScore = isA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    if (myScore > oppScore) wins++;
    else if (myScore < oppScore) losses++;
  }
  return { wins, losses };
}

function computeTeamAvgStats(rows: MPS[]) {
  if (!rows.length) return { avgRating: null, avgAdr: null, avgKd: null };
  const totalKills = sumNums(rows.map((r) => r.kills)) ?? 0;
  const totalDeaths = sumNums(rows.map((r) => r.deaths)) ?? 0;
  return {
    avgRating: avgNums(rows.map((r) => r.ratingPro)),
    avgAdr: avgNums(rows.map((r) => r.adr)),
    avgKd: totalDeaths > 0 ? totalKills / totalDeaths : null,
  };
}

function buildRadarData(
  mapPool: string[],
  mapWin: Map<string, MapWinStats>,
  pickStats: { pickCount: Map<string, number>; bpMatchCount: number },
  banStats: { banCount: Map<string, number>; bpMatchCount: number },
): Map<string, { winRate: number; pickRate: number; banRate: number }> {
  const data = new Map<string, { winRate: number; pickRate: number; banRate: number }>();
  for (const map of mapPool) {
    const win = mapWin.get(map);
    data.set(map, {
      winRate: win && win.played > 0 ? (win.wins / win.played) * 100 : 0,
      pickRate: pickStats.bpMatchCount > 0 ? ((pickStats.pickCount.get(map) ?? 0) / pickStats.bpMatchCount) * 100 : 0,
      banRate: banStats.bpMatchCount > 0 ? ((banStats.banCount.get(map) ?? 0) / banStats.bpMatchCount) * 100 : 0,
    });
  }
  return data;
}

async function getSeasonFinishedMatches(seasonId: string, teamId: string) {
  return db.query.matches.findMany({
    where: and(
      eq(matches.seasonId, seasonId),
      eq(matches.status, "finished"),
      or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
    ),
  });
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;

  const [season, match] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    db.query.matches.findFirst({ where: eq(matches.id, matchId) }),
  ]);
  if (!season) notFound();
  if (!match || match.seasonId !== season.id) notFound();

  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;

  const [teamA, teamB, maps] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
    db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
    db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, matchId),
      orderBy: (t, { asc }) => [asc(t.mapOrder)],
    }),
  ]);

  const isFinished = match.status === "finished";

  // Phase 3: 所有独立查询并行
  const [timeProposals, rosterA, rosterB, userSession, allTeamMembers, seasonMatchesA, seasonMatchesB] =
    await Promise.all([
      getTimeProposals(match.id),
      getMatchRoster(match.id, match.teamAId),
      getMatchRoster(match.id, match.teamBId),
      getUserSession(),
      db
        .select({
          id: teamMembers.id,
          teamId: teamMembers.teamId,
          steamName: users.steamName,
          displayName: users.displayName,
          perfectName: users.perfectName,
          primaryPosition: seasonRegistrations.primaryPosition,
          userId: users.id,
        })
        .from(teamMembers)
        .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
        .innerJoin(users, eq(seasonRegistrations.userId, users.id))
        .where(inArray(teamMembers.teamId, [match.teamAId, match.teamBId])),
      getSeasonFinishedMatches(season.id, match.teamAId),
      getSeasonFinishedMatches(season.id, match.teamBId),
    ]);

  // 从赛季对局列表计算战绩、H2H
  const recordA = computeRecord(match.teamAId, seasonMatchesA);
  const recordB = computeRecord(match.teamBId, seasonMatchesB);

  const matchIdsA = seasonMatchesA.map((m) => m.id);
  const matchIdsB = seasonMatchesB.map((m) => m.id);

  // H2H：teamA 的赛季对局中与 teamB 的交手记录
  const h2hRaw = seasonMatchesA
    .filter((m) => m.teamAId === match.teamBId || m.teamBId === match.teamBId)
    .sort((a, b) => {
      const ta = (a.completedAt ?? a.scheduledAt)?.getTime() ?? 0;
      const tb = (b.completedAt ?? b.scheduledAt)?.getTime() ?? 0;
      return tb - ta;
    });

  const h2hMatches = h2hRaw.slice(0, 10).map((m) => {
    const aIsTeamA = m.teamAId === match.teamAId;
    const scoreA = aIsTeamA ? (m.scoreA ?? 0) : (m.scoreB ?? 0);
    const scoreB = aIsTeamA ? (m.scoreB ?? 0) : (m.scoreA ?? 0);
    return {
      matchId: m.id,
      scheduledAt: m.scheduledAt,
      completedAt: m.completedAt,
      stage: m.stage,
      format: m.format,
      scoreA,
      scoreB,
      teamAWon: scoreA > scoreB,
    };
  });

  const h2hWinsA = h2hMatches.filter((m) => m.teamAWon).length;
  const h2hWinsB = h2hMatches.filter((m) => !m.teamAWon).length;

  // 建立 userId 集合
  const teamAUserIds = allTeamMembers
    .filter((m) => m.teamId === match.teamAId && m.userId)
    .map((m) => m.userId as string);
  const teamBUserIds = allTeamMembers
    .filter((m) => m.teamId === match.teamBId && m.userId)
    .map((m) => m.userId as string);
  const userIdToTeamId = new Map<string, string>(
    allTeamMembers.filter((m) => m.userId).map((m) => [m.userId as string, m.teamId]),
  );
  const userIdToMember = new Map(
    allTeamMembers.filter((m) => m.userId).map((m) => [m.userId as string, m]),
  );

  // 首发阵容 userId（来自已提交名单）
  const starterAMemberIds = new Set(
    rosterA ? rosterA.players.filter((p) => p.isStarter).map((p) => p.teamMemberId) : [],
  );
  const starterBMemberIds = new Set(
    rosterB ? rosterB.players.filter((p) => p.isStarter).map((p) => p.teamMemberId) : [],
  );
  const starterAUserIds = allTeamMembers
    .filter((m) => m.teamId === match.teamAId && starterAMemberIds.has(m.id) && m.userId)
    .map((m) => m.userId as string);
  const starterBUserIds = allTeamMembers
    .filter((m) => m.teamId === match.teamBId && starterBMemberIds.has(m.id) && m.userId)
    .map((m) => m.userId as string);

  // Phase 4: 地图胜/pick/ban 率 + 队伍赛季数据（全部并行）
  const [
    mapWinA, mapWinB,
    pickStatsA, pickStatsB,
    banStatsA, banStatsB,
    teamRawStatsA, teamRawStatsB,
  ] = await Promise.all([
    getTeamMapWinStats(match.teamAId, seasonMatchesA),
    getTeamMapWinStats(match.teamBId, seasonMatchesB),
    getTeamPickStats(match.teamAId, matchIdsA),
    getTeamPickStats(match.teamBId, matchIdsB),
    getTeamBanStats(match.teamAId, matchIdsA),
    getTeamBanStats(match.teamBId, matchIdsB),
    teamAUserIds.length > 0 && matchIdsA.length > 0
      ? db.select().from(matchPlayerStats).where(
          and(
            inArray(matchPlayerStats.matchId, matchIdsA),
            inArray(matchPlayerStats.userId as never, teamAUserIds),
            isNotNull(matchPlayerStats.verifiedByAdmin),
          ),
        )
      : ([] as MPS[]),
    teamBUserIds.length > 0 && matchIdsB.length > 0
      ? db.select().from(matchPlayerStats).where(
          and(
            inArray(matchPlayerStats.matchId, matchIdsB),
            inArray(matchPlayerStats.userId as never, teamBUserIds),
            isNotNull(matchPlayerStats.verifiedByAdmin),
          ),
        )
      : ([] as MPS[]),
  ]);

  // 首发选手赛季数据从 teamRawStats 内存过滤（启动者是队伍成员子集）
  const starterAIdSet = new Set(starterAUserIds);
  const starterBIdSet = new Set(starterBUserIds);
  const starterStatsA = teamRawStatsA.filter((r) => r.userId && starterAIdSet.has(r.userId));
  const starterStatsB = teamRawStatsB.filter((r) => r.userId && starterBIdSet.has(r.userId));

  // 队伍赛季平均数据（用于 TeamStatsCompare）
  const teamAvgA = computeTeamAvgStats(teamRawStatsA);
  const teamAvgB = computeTeamAvgStats(teamRawStatsB);

  // 雷达图数据
  const radarDataA = buildRadarData(mapPool, mapWinA, pickStatsA, banStatsA);
  const radarDataB = buildRadarData(mapPool, mapWinB, pickStatsB, banStatsB);

  // 首发选手赛季数据（用于 MatchLineupsH2H）
  function buildLineupsPlayers(rows: MPS[], starterUserIds: string[]) {
    const grouped = new Map<string, MPS[]>();
    for (const r of rows) {
      if (!r.userId) continue;
      const list = grouped.get(r.userId) ?? [];
      list.push(r);
      grouped.set(r.userId, list);
    }
    return starterUserIds.map((userId) => {
      const playerRows = grouped.get(userId) ?? [];
      const member = userIdToMember.get(userId);
      const perfectName =
        playerRows[0]?.perfectName ?? member?.perfectName ?? member?.displayName ?? member?.steamName ?? "未知";
      const totalKills = sumNums(playerRows.map((r) => r.kills)) ?? 0;
      const totalDeaths = sumNums(playerRows.map((r) => r.deaths)) ?? 0;
      const firstKills = sumNums(playerRows.map((r) => r.firstKills)) ?? 0;
      return {
        userId,
        perfectName,
        maps: playerRows.length,
        avgRating: avgNums(playerRows.map((r) => r.ratingPro)) ?? 0,
        avgAdr: avgNums(playerRows.map((r) => r.adr)) ?? 0,
        kdRatio: totalDeaths > 0 ? totalKills / totalDeaths : null,
        avgHs: avgNums(playerRows.map((r) => r.hsPercent)) ?? 0,
        avgFk: playerRows.length > 0 ? firstKills / playerRows.length : 0,
        avgWe: avgNums(playerRows.map((r) => r.we)) ?? 0,
      };
    });
  }

  const lineupsPlayersA = buildLineupsPlayers(starterStatsA, starterAUserIds);
  const lineupsPlayersB = buildLineupsPlayers(starterStatsB, starterBUserIds);
  const showLineupsH2H =
    lineupsPlayersA.length > 0 &&
    lineupsPlayersB.length > 0 &&
    (lineupsPlayersA.some((p) => p.maps > 0) || lineupsPlayersB.some((p) => p.maps > 0));

  // 队长 / 管理员权限检查
  interface RosterPlayer {
    steamName: string;
    displayName: string | null;
    perfectName: string | null;
    primaryPosition: string;
    isStarter: boolean;
    userId?: string | null;
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
        displayName: m.displayName ?? null,
        perfectName: m.perfectName ?? null,
        primaryPosition: m.primaryPosition,
        isStarter: playerMap.get(m.id) ?? false,
        userId: m.userId ?? null,
      }));
  }

  let isCaptainA = false;
  let isCaptainB = false;
  let isSeasonAdmin = false;
  let captainTeamMembers: { id: string; steamName: string; displayName: string | null; perfectName: string | null; primaryPosition: string }[] = [];

  if (userSession?.userId) {
    isSeasonAdmin =
      userSession.role === "super_admin" ||
      (userSession.role === "season_admin" && userSession.adminSeasonIds.includes(season.id));

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
            displayName: r.displayName ?? null,
            perfectName: r.perfectName ?? null,
            primaryPosition: r.primaryPosition,
          }));
      }
    }
  }

  const captainRoster = isCaptainA ? rosterA : isCaptainB ? rosterB : null;
  const teamARoster: RosterPlayer[] | null = rosterA
    ? buildRoster(rosterA, allTeamMembers, match.teamAId)
    : null;
  const teamBRoster: RosterPlayer[] | null = rosterB
    ? buildRoster(rosterB, allTeamMembers, match.teamBId)
    : null;

  // MVP 投票 + 整场汇总数据（已结束比赛）
  let mvpCandidates: {
    userId: string | null;
    perfectName: string;
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    hsPercent: number | null;
    firstKills: number | null;
    multiKills: number | null;
    clutches: number | null;
    adr: number | null;
    rws: number | null;
    ratingPro: number | null;
    we: number | null;
  }[] = [];
  let mvpVoteResults: Awaited<ReturnType<typeof getMatchMvpResults>> = [];
  let userVoted: string | null = null;
  let summaryPlayers: {
    userId: string | null;
    perfectName: string;
    teamId: string;
    kills: number;
    deaths: number;
    assists: number;
    hsPercent: number | null;
    firstKills: number;
    multiKills: number;
    clutches: number;
    adr: number | null;
    rws: number | null;
    ratingPro: number | null;
    we: number | null;
    mapsPlayed: number;
  }[] = [];

  if (isFinished) {
    const allStats = await db.query.matchPlayerStats.findMany({
      where: eq(matchPlayerStats.matchId, match.id),
    });

    const groupMap = new Map<string, typeof allStats>();
    for (const s of allStats) {
      const key = s.userId ?? `name:${s.perfectName}`;
      const list = groupMap.get(key) ?? [];
      list.push(s);
      groupMap.set(key, list);
    }

    const aggregated = Array.from(groupMap.values()).map((rows) => ({
      userId: rows[0].userId,
      perfectName: rows[0].perfectName,
      kills: sumNums(rows.map((r) => r.kills)),
      deaths: sumNums(rows.map((r) => r.deaths)),
      assists: sumNums(rows.map((r) => r.assists)),
      hsPercent: weightedAvgNums(rows.map((r) => r.hsPercent), rows.map((r) => r.kills)),
      firstKills: sumNums(rows.map((r) => r.firstKills)),
      multiKills: sumNums(rows.map((r) => r.multiKills)),
      clutches: sumNums(rows.map((r) => r.clutches)),
      adr: avgNums(rows.map((r) => r.adr)),
      rws: avgNums(rows.map((r) => r.rws)),
      ratingPro: avgNums(rows.map((r) => r.ratingPro)),
      we: avgNums(rows.map((r) => r.we)),
    }));

    mvpCandidates = aggregated
      .sort((a, b) => (b.ratingPro ?? 0) - (a.ratingPro ?? 0))
      .slice(0, 4);

    // 整场汇总（BO3/BO5 用，带 teamId）
    summaryPlayers = aggregated
      .map((p) => ({
        ...p,
        teamId: p.userId ? (userIdToTeamId.get(p.userId) ?? "") : "",
        mapsPlayed: groupMap.get(p.userId ?? `name:${p.perfectName}`)?.length ?? 1,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        assists: p.assists ?? 0,
        firstKills: p.firstKills ?? 0,
        multiKills: p.multiKills ?? 0,
        clutches: p.clutches ?? 0,
      }))
      .filter((p) => p.teamId === match.teamAId || p.teamId === match.teamBId);

    mvpVoteResults = await getMatchMvpResults(match.id);
    ensureMvpWinner(match.id);

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

  const showSummaryTab = isFinished && match.format !== "bo1" && summaryPlayers.length > 0;
  const defaultTab = showSummaryTab ? "summary" : (maps[0]?.id ?? "");

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
        className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 py-8"
        style={{
          background:
            teamA && teamB
              ? `linear-gradient(90deg, ${teamBadgeData(teamA.name, 0).color}15 0%, transparent 35%, transparent 65%, ${teamBadgeData(teamB.name, 1).color}15 100%)`
              : `var(--color-panel-low)`,
          borderRadius: "var(--radius-lg)",
          border: `1px solid var(--color-border)`,
        }}
      >
        {/* Team A */}
        <div className="flex items-center gap-4 justify-end">
          <div className="text-right min-w-0">
            <Link
              href={`/${seasonSlug}/teams/${match.teamAId}`}
              className="font-bold text-lg sm:text-[28px] hover:text-[var(--color-accent)] transition-colors"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamA?.name ?? "未知队伍"}
            </Link>
          </div>
          {teamA && (
            <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0">
              {teamA.logoUrl ? (
                <Image
                  src={teamA.logoUrl}
                  alt={teamA.name}
                  width={64}
                  height={64}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <TeamBadge team={teamBadgeData(teamA.name, 0)} size={64} />
              )}
            </div>
          )}
        </div>

        {/* 比分 / VS */}
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
              className="font-bold text-4xl sm:text-[56px]"
              style={{
                fontFamily: "var(--font-mono)",
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
          {teamB && (
            <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0">
              {teamB.logoUrl ? (
                <Image
                  src={teamB.logoUrl}
                  alt={teamB.name}
                  width={64}
                  height={64}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <TeamBadge team={teamBadgeData(teamB.name, 1)} size={64} />
              )}
            </div>
          )}
          <div className="min-w-0">
            <Link
              href={`/${seasonSlug}/teams/${match.teamBId}`}
              className="font-bold text-lg sm:text-[28px] hover:text-[var(--color-accent)] transition-colors"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamB?.name ?? "未知队伍"}
            </Link>
          </div>
        </div>
      </div>

      {/* 时间显示 */}
      <div className="text-center text-xs text-[var(--color-fg-dim)]">
        {isFinished
          ? match.completedAt
            ? `完成于 ${formatCSTDateTime(match.completedAt)}`
            : "结束时间未记录"
          : match.scheduledAt
          ? `计划于 ${formatCSTDateTime(match.scheduledAt)}`
          : "未排期"}
      </div>

      {/* 赛季综合对比（赛前） */}
      {!isFinished && (
        <TeamStatsCompare
          teamAName={teamA?.name ?? "队伍 A"}
          teamBName={teamB?.name ?? "队伍 B"}
          statA={{ ...recordA, ...teamAvgA }}
          statB={{ ...recordB, ...teamAvgB }}
        />
      )}

      {/* 地图池雷达图（赛前） */}
      {!isFinished && mapPool.length > 0 && (
        <Panel label="地图池">
          <MapPoolRadarChart
            mapPool={mapPool}
            teamAName={teamA?.name ?? "A"}
            teamBName={teamB?.name ?? "B"}
            teamAData={radarDataA}
            teamBData={radarDataB}
          />
        </Panel>
      )}

      {/* 历史交锋（赛前） */}
      {!isFinished && (
        <MatchHeadToHead
          teamAName={teamA?.name ?? "队伍 A"}
          teamBName={teamB?.name ?? "队伍 B"}
          teamAWins={h2hWinsA}
          teamBWins={h2hWinsB}
          matches={h2hMatches}
          seasonSlug={seasonSlug}
        />
      )}

      {/* BP 流程（进行中 / 已结束时显示） */}
      {match.status !== "scheduled" && (
        <VetoView
          matchId={match.id}
          teamAName={teamA?.name ?? "队伍 A"}
          teamBName={teamB?.name ?? "队伍 B"}
          teamAId={match.teamAId}
          teamBId={match.teamBId}
        />
      )}

      {/* 地图结果 */}
      {maps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">地图结果</h2>
          <Tabs defaultValue={defaultTab}>
            <TabsList>
              {showSummaryTab && (
                <TabsTrigger value="summary" className="text-xs">
                  整场汇总
                </TabsTrigger>
              )}
              {maps.map((map) => (
                <TabsTrigger key={map.id} value={map.id} className="text-xs">
                  {mapLabel(map.mapName)}
                  {map.pickedByTeamId && (
                    <span
                      className="ml-1 text-[10px] font-mono px-1 py-0.5"
                      style={{ background: "rgba(77,212,122,0.12)", color: "var(--color-ok)" }}
                    >
                      {map.pickedByTeamId === match.teamAId
                        ? teamA?.name?.slice(0, 3).toUpperCase()
                        : teamB?.name?.slice(0, 3).toUpperCase()}{" "}
                      PICK
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* 整场汇总 Tab */}
            {showSummaryTab && (
              <TabsContent value="summary">
                <MatchSummaryStats
                  players={summaryPlayers}
                  teamAId={match.teamAId}
                  teamBId={match.teamBId}
                  teamAName={teamA?.name ?? "队伍 A"}
                  teamBName={teamB?.name ?? "队伍 B"}
                  seasonSlug={seasonSlug}
                />
              </TabsContent>
            )}

            {/* 单图 Tab */}
            {maps.map((map) => (
              <TabsContent key={map.id} value={map.id}>
                <Panel pad={16} className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-fg-mid)] w-5">#{map.mapOrder}</span>
                      <span className="font-medium text-[var(--color-fg)]">{mapLabel(map.mapName)}</span>
                      {map.pickedByTeamId === match.teamAId && <PosChip pos={`${teamA?.name} Pick`} />}
                      {map.pickedByTeamId === match.teamBId && <PosChip pos={`${teamB?.name} Pick`} />}
                      {map.pickedByTeamId === null && <PosChip pos="决胜图" />}
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
                  {isFinished && <PlayerStatsTable matchId={match.id} mapId={map.id} />}
                  {!isFinished && map.scoreA == null && (
                    <p className="text-xs text-[var(--color-fg-dim)] py-2">比赛未开始</p>
                  )}
                  {isFinished && isSeasonAdmin && <StatsOCRPanel mapId={map.id} mapName={map.mapName} />}
                </Panel>
              </TabsContent>
            ))}
          </Tabs>
        </section>
      ) : isFinished && match.scoreA != null && match.scoreB != null ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛结果</h2>
          <Panel pad={16}>
            <p className="text-sm text-[var(--color-fg-mid)]">
              {MATCH_FORMAT_LABELS[match.format] ?? match.format.toUpperCase()} 系列赛总分：{match.scoreA} :{" "}
              {match.scoreB}
            </p>
          </Panel>
        </section>
      ) : null}

      {/* 阵容对比（赛前，双方名单提交后且有赛季数据时显示） */}
      {!isFinished && showLineupsH2H && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">阵容对比</h2>
          <MatchLineupsH2H
            teamAName={teamA?.name ?? "队伍 A"}
            teamBName={teamB?.name ?? "队伍 B"}
            teamAPlayers={lineupsPlayersA}
            teamBPlayers={lineupsPlayersB}
          />
        </section>
      )}

      {/* 赛前名单 */}
      {!isFinished && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">赛前名单</h2>
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
                scheduledAt={match.scheduledAt}
              />
            </Panel>
          )}
        </section>
      )}

      {/* 比赛时间协商 */}
      {match.status === "scheduled" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛时间协商</h2>
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
              hasSubmittedRoster={captainRoster?.status === "submitted"}
            />
          </Panel>
          <Panel pad={16}>
            <h3 className="text-sm font-medium mb-2">协商历史</h3>
            <TimeProposalHistory proposals={timeProposals} />
          </Panel>
        </section>
      )}

      {/* MVP 投票（2×2） */}
      {isFinished && mvpCandidates.length > 0 && (
        <MatchMvpVote
          matchId={match.id}
          candidates={mvpCandidates}
          currentVotes={mvpVoteResults}
          userVotedPlayerName={userVoted}
          completedAt={match.completedAt?.toISOString() ?? null}
        />
      )}
    </div>
  );
}
