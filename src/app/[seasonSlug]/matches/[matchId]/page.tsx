import { notFound } from "next/navigation";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, users, seasonRegistrations, teamMembers } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";
import { Panel, PosChip } from "@/components/rivalhub";
import { mapLabel } from "@/lib/maps";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MATCH_FORMAT_LABELS, SIDE_LABELS } from "@/types/match";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { DemoImportPanel } from "@/components/admin/DemoImportPanel";
import { TimeProposalHistory } from "@/components/matches/TimeProposalHistory";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
import { MatchRosterView } from "@/components/matches/MatchRosterView";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";
import { VetoView } from "@/components/matches/VetoView";
import { MapPoolRadarChart } from "@/components/matches/MapPoolRadarChart";
import { MatchLineupsH2H } from "@/components/matches/MatchLineupsH2H";
import { PlayerRadarChart } from "@/components/matches/PlayerRadarChart";
import { TeamStatsCompare } from "@/components/matches/TeamStatsCompare";
import { MatchHeadToHead } from "@/components/matches/MatchHeadToHead";
import { MatchSummaryStats } from "@/components/matches/MatchSummaryStats";
import { getMatchMvpResults, ensureMvpWinner } from "@/actions/player-stats";
import { getTimeProposals } from "@/actions/matches/scheduling";
import { getDemoDetail } from "@/actions/demo-detail";
import { DemoPlayerStatsTable } from "@/components/matches/DemoPlayerStatsTable";
import { PlayerKillHeatmap } from "@/components/matches/PlayerKillHeatmap";
import { PlayerWeaponBreakdown } from "@/components/matches/PlayerWeaponBreakdown";
import { DemoRoundTimeline } from "@/components/matches/DemoRoundTimeline";
import { DemoKillFeed } from "@/components/matches/DemoKillFeed";
import { DemoEconomyChart } from "@/components/matches/DemoEconomyChart";
import { DemoClutchList } from "@/components/matches/DemoClutchList";
import { PlayerEntryStats } from "@/components/matches/PlayerEntryStats";
import { PlayerClutchStats } from "@/components/matches/PlayerClutchStats";
import { PlayerUtilityStats } from "@/components/matches/PlayerUtilityStats";
import { getTimeBufferHoursForStage } from "@/lib/matches/time-rules";
import { getMatchRoster } from "@/actions/matches/roster";
import { getSeasonHexagonScores } from "@/actions/hexagon";
import { computeTeamDimensions } from "@/lib/utils/hexagon";
import type { HexagonScores } from "@/lib/utils/hexagon";
import { getUserSession } from "@/lib/auth/session";
import { normalizeRegistrationConfig } from "@/types/season";
import { getTeamMapWinStats, getTeamPickStats, getTeamBanStats } from "@/lib/teams/data";
import {
  aggregateFinishedPlayerStats,
  buildLineupsPlayers,
  buildRadarData,
  buildRoster,
  computeRecord,
  computeTeamAvgStats,
  type MatchPlayerStatsRow,
  type RosterPlayer,
} from "@/lib/matches/detail-stats";
import { getSeasonFinishedMatches } from "@/lib/matches/detail-data";
import { computeRecommendedMvp } from "@/lib/stats/mvp";
import { MatchHeroHeader } from "@/components/matches/MatchHeroHeader";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
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
  const [timeProposals, rosterA, rosterB, userSession, allTeamMembers, seasonMatchesA, seasonMatchesB, seasonHexagonScores] =
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
      getSeasonHexagonScores(season.id),
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
  const allSeasonMatchIds = [...new Set([...matchIdsA, ...matchIdsB])];
  const [
    mapWinA, mapWinB,
    pickStatsA, pickStatsB,
    banStatsA, banStatsB,
    teamRawStatsA, teamRawStatsB,
    seasonMapScoresRaw,
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
      : ([] as MatchPlayerStatsRow[]),
    teamBUserIds.length > 0 && matchIdsB.length > 0
      ? db.select().from(matchPlayerStats).where(
          and(
            inArray(matchPlayerStats.matchId, matchIdsB),
            inArray(matchPlayerStats.userId as never, teamBUserIds),
            isNotNull(matchPlayerStats.verifiedByAdmin),
          ),
        )
      : ([] as MatchPlayerStatsRow[]),
    // 赛季历史图级回合数（用于 buildLineupsPlayers 的 fkpr / adr 正确计算）
    allSeasonMatchIds.length > 0
      ? db
          .select({ id: matchMaps.id, scoreA: matchMaps.scoreA, scoreB: matchMaps.scoreB })
          .from(matchMaps)
          .where(inArray(matchMaps.matchId, allSeasonMatchIds))
      : Promise.resolve([] as { id: string; scoreA: number | null; scoreB: number | null }[]),
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

  // 双方阵容六维雷达图
  const hexA = starterAUserIds
    .map((uid) => seasonHexagonScores.get(uid))
    .filter((s): s is HexagonScores => s != null);
  const hexB = starterBUserIds
    .map((uid) => seasonHexagonScores.get(uid))
    .filter((s): s is HexagonScores => s != null);
  const teamHexA = hexA.length > 0 ? computeTeamDimensions(hexA) : null;
  const teamHexB = hexB.length > 0 ? computeTeamDimensions(hexB) : null;
  const showHexComparison = teamHexA != null && teamHexB != null && !isFinished;

  // 首发选手赛季数据（用于 MatchLineupsH2H）
  // 用图级比分构建 mapRoundsMap（key: mapId），修复原来用系列赛比分当回合数的 bug
  const seasonMapRoundsMap = new Map<string, number>();
  for (const m of seasonMapScoresRaw) {
    if (m.scoreA !== null && m.scoreB !== null) {
      seasonMapRoundsMap.set(m.id, m.scoreA + m.scoreB);
    }
  }

  // 当前比赛图级回合数（用于 aggregateFinishedPlayerStats）
  const currentMapRoundsMap = new Map<string, number>();
  for (const m of maps) {
    if (m.scoreA !== null && m.scoreB !== null) {
      currentMapRoundsMap.set(m.id, m.scoreA + m.scoreB);
    }
  }

  const lineupsPlayersA = buildLineupsPlayers(starterStatsA, starterAUserIds, userIdToMember, seasonMapRoundsMap);
  const lineupsPlayersB = buildLineupsPlayers(starterStatsB, starterBUserIds, userIdToMember, seasonMapRoundsMap);
  const showLineupsH2H =
    lineupsPlayersA.length > 0 &&
    lineupsPlayersB.length > 0 &&
    (lineupsPlayersA.some((p) => p.maps > 0) || lineupsPlayersB.some((p) => p.maps > 0));

  // 队长 / 管理员权限检查
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
  let recommendedMvpName: string | null = null;
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

    const rankMetric = season.statProfile.rankMetric;
    const aggregatedStats = aggregateFinishedPlayerStats(allStats, userIdToTeamId, match.teamAId, match.teamBId, currentMapRoundsMap, rankMetric);
    mvpCandidates = aggregatedStats.mvpCandidates;
    summaryPlayers = aggregatedStats.summaryPlayers;
    recommendedMvpName = computeRecommendedMvp(mvpCandidates)?.perfectName ?? null;

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

  const showSummaryTab = isFinished && summaryPlayers.length > 0;
  const defaultTab = showSummaryTab ? "summary" : (maps[0]?.id ?? "");

  // Demo 明细数据（已结束比赛）
  const finishedMaps = isFinished
    ? maps.filter((m) => m.scoreA !== null && m.scoreB !== null)
    : [];
  const demoDataByMapId = new Map<string, Awaited<ReturnType<typeof getDemoDetail>>>();
  if (isFinished && finishedMaps.length > 0) {
    const results = await Promise.all(
      finishedMaps.map((m) => getDemoDetail(m.id)),
    );
    for (let i = 0; i < finishedMaps.length; i++) {
      demoDataByMapId.set(finishedMaps[i].id, results[i]);
    }
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-8">
      <MatchHeroHeader
        seasonSlug={seasonSlug}
        match={match}
        teamA={teamA}
        teamB={teamB}
        isFinished={isFinished}
      />

      {/* 赛季综合对比（比赛未结束时显示） */}
      {!isFinished && (
        <TeamStatsCompare
          teamAName={teamA?.name ?? "队伍 A"}
          teamBName={teamB?.name ?? "队伍 B"}
          statA={{ ...recordA, ...teamAvgA }}
          statB={{ ...recordB, ...teamAvgB }}
        />
      )}

      {/* 地图池雷达图（比赛未结束时显示） */}
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

      {/* 历史交锋（比赛未结束时显示） */}
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
              {/* 已结束比赛仅显示已录入比分的图；进行中/未开始显示所有地图 */}
              {(isFinished ? maps.filter((m) => m.scoreA !== null && m.scoreB !== null) : maps).map((map) => (
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
            {(isFinished ? maps.filter((m) => m.scoreA !== null && m.scoreB !== null) : maps).map((map) => (
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
                  {isFinished && (
                    <PlayerStatsTable
                      mapId={map.id}
                      teamAId={match.teamAId}
                      teamBId={match.teamBId}
                      teamAName={teamA?.name ?? "队伍 A"}
                      teamBName={teamB?.name ?? "队伍 B"}
                      seasonId={season.id}
                      seasonSlug={seasonSlug}
                    />
                  )}
                  {!isFinished && map.scoreA == null && (
                    <p className="text-xs text-[var(--color-fg-dim)] py-2">比赛未开始</p>
                  )}
                  {isFinished && isSeasonAdmin && <StatsOCRPanel mapId={map.id} mapName={map.mapName} />}
                  {isFinished && isSeasonAdmin && <DemoImportPanel mapId={map.id} mapName={map.mapName} />}
                  {/* Demo 明细区块 */}
                  {isFinished && (() => {
                    const demoResult = demoDataByMapId.get(map.id);
                    if (!demoResult?.success || !demoResult.data) return null;
                    const d = demoResult.data;
                    return (
                      <div className="space-y-4 pt-2 border-t border-[var(--color-border)]">
                        <h3 className="text-sm font-semibold text-[var(--color-fg)]">
                          Demo Data
                        </h3>
                        <DemoPlayerStatsTable
                          players={d.playerStats}
                          teamAName={teamA?.name ?? "Team A"}
                          teamBName={teamB?.name ?? "Team B"}
                          seasonSlug={seasonSlug}
                          playerNameMap={d.playerNameMap}
                        />
                        <DemoRoundTimeline rounds={d.rounds} />
                        <Panel label="Kill Feed">
                          <DemoKillFeed kills={d.kills} playerNameMap={d.playerNameMap} />
                        </Panel>
                        <Panel label="Economy">
                          <DemoEconomyChart
                            economies={d.economies}
                            teamAName={teamA?.name ?? "Team A"}
                            teamBName={teamB?.name ?? "Team B"}
                            roundTypes={d.rounds.map((r) => ({
                              roundNumber: r.roundNumber,
                              teamAEconomy: r.teamAEconomy,
                              teamBEconomy: r.teamBEconomy,
                            }))}
                          />
                        </Panel>
                        <Panel label="Clutch Replays">
                          <DemoClutchList clutches={d.clutches} playerNameMap={d.playerNameMap} />
                        </Panel>
                        <Panel label="Heatmap">
                          <PlayerKillHeatmap
                            mapName={map.mapName}
                            rawKills={d.rawKills}
                            playerStats={d.playerStats}
                            playerNameMap={d.playerNameMap}
                          />
                        </Panel>
                        <PlayerWeaponBreakdown
                          rawKills={d.rawKills}
                          playerStats={d.playerStats}
                          playerNameMap={d.playerNameMap}
                        />
                        <PlayerEntryStats
                          kills={d.kills}
                          playerStats={d.playerStats}
                          playerNameMap={d.playerNameMap}
                        />
                        <PlayerClutchStats
                          clutches={d.clutches}
                          playerStats={d.playerStats}
                          playerNameMap={d.playerNameMap}
                        />
                        <PlayerUtilityStats
                          kills={d.kills}
                          playerStats={d.playerStats}
                          playerNameMap={d.playerNameMap}
                        />
                      </div>
                    );
                  })()}
                </Panel>
              </TabsContent>
            ))}
          </Tabs>
        </section>
      ) : isFinished && match.scoreA != null && match.scoreB != null ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛结果</h2>
          {match.isForfeit ? (
            <Panel pad={16}>
              <p className="text-sm text-[var(--color-fg-mid)]">
                本场比赛以弃赛结束，未进行实际对局。
              </p>
            </Panel>
          ) : summaryPlayers.length > 0 ? (
            <MatchSummaryStats
              players={summaryPlayers}
              teamAId={match.teamAId}
              teamBId={match.teamBId}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              seasonSlug={seasonSlug}
            />
          ) : (
            <Panel pad={16}>
              <p className="text-sm text-[var(--color-fg-mid)]">
                {MATCH_FORMAT_LABELS[match.format] ?? match.format.toUpperCase()} 系列赛总分：{match.scoreA} : {match.scoreB}
              </p>
            </Panel>
          )}
        </section>
      ) : null}

      {/* 阵容对比（比赛未结束时显示，双方名单提交后且有赛季数据时显示） */}
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

      {showHexComparison && (
        <section className="space-y-3">
          <Panel label="六维能力对比" pad={16}>
            <PlayerRadarChart
              players={[
                { name: teamA?.name ?? "队伍 A", scores: teamHexA, color: "var(--color-accent)", strokeColor: "var(--color-accent)" },
                { name: teamB?.name ?? "队伍 B", scores: teamHexB, color: "var(--color-accent-b)", strokeColor: "var(--color-accent-b)" },
              ]}
              size={320}
            />
          </Panel>
          <p className="text-[11px] text-[var(--color-fg-dim)] px-1 leading-relaxed">
            双方预计出场阵容六维均值对比，六维评分在本赛事内标准化。
          </p>
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
              bufferHours={getTimeBufferHoursForStage(season.stagePlan, match.stage)}
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
          recommendedMvpName={recommendedMvpName}
          completedAt={match.completedAt?.toISOString() ?? null}
        />
      )}
    </div>
  );
}
