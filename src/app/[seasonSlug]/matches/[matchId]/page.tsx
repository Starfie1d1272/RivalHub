import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { eq, and, or, inArray } from "drizzle-orm";
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
import { getMatchMvpResults } from "@/actions/player-stats";
import { getTimeProposals } from "@/actions/matches/scheduling";
import { getMatchRoster } from "@/actions/matches/roster";
import { sumNums, avgNums, weightedAvgNums } from "@/lib/utils/stats";
import { getUserSession } from "@/lib/auth/session";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

const TEAM_COLORS = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];

function teamBadgeData(name: string, idx: number): { tag: string; color: string } {
  return { tag: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[idx % TEAM_COLORS.length] };
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;

  const [season, match] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    db.query.matches.findFirst({ where: eq(matches.id, matchId) }),
  ]);
  if (!season) notFound();
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

  const [timeProposals, rosterA, rosterB, userSession] = await Promise.all([
    getTimeProposals(match.id),
    getMatchRoster(match.id, match.teamAId),
    getMatchRoster(match.id, match.teamBId),
    getUserSession(),
  ]);

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

  if (isFinished) {
    const allStats = await db.query.matchPlayerStats.findMany({
      where: eq(matchPlayerStats.matchId, match.id),
    });

    // 按玩家分组，跨地图聚合
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

    // 按平均 Rating 降序，取前 4
    mvpCandidates = aggregated
      .sort((a, b) => (b.ratingPro ?? 0) - (a.ratingPro ?? 0))
      .slice(0, 4);

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

  const allTeamMembers = await db
    .select({
      id: teamMembers.id,
      teamId: teamMembers.teamId,
      steamName: users.steamName,
      displayName: users.displayName,
      perfectName: users.perfectName,
      primaryPosition: seasonRegistrations.primaryPosition,
    })
    .from(teamMembers)
    .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
    .innerJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(
      inArray(teamMembers.teamId, [match.teamAId, match.teamBId]),
    );

  let isCaptainA = false;
  let isCaptainB = false;
  let isSeasonAdmin = false;
  let captainTeamMembers: { id: string; steamName: string; displayName: string | null; perfectName: string | null; primaryPosition: string }[] = [];

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
            displayName: r.displayName ?? null,
            perfectName: r.perfectName ?? null,
            primaryPosition: r.primaryPosition,
          }));
      }
    }
  }

  interface RosterPlayer {
    steamName: string;
    displayName: string | null;
    perfectName: string | null;
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
        displayName: m.displayName ?? null,
        perfectName: m.perfectName ?? null,
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
        className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 py-8 border-b"
        style={{
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
              className="font-bold text-lg sm:text-[28px]"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamA?.name ?? "未知队伍"}
            </div>
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
            <div
              className="font-bold text-lg sm:text-[28px]"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamB?.name ?? "未知队伍"}
            </div>
          </div>
        </div>
      </div>

      {/* BP 流程 */}
      <VetoView
        matchId={match.id}
        teamAName={teamA?.name ?? "队伍 A"}
        teamBName={teamB?.name ?? "队伍 B"}
        teamAId={match.teamAId}
        teamBId={match.teamBId}
      />

      {/* 地图结果 — 有 maps 时用 Tab 切换，无 maps 时 fallback */}
      {maps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">地图结果</h2>
          <Tabs defaultValue={maps[0].id}>
            <TabsList>
              {maps.map((map) => (
                <TabsTrigger key={map.id} value={map.id} className="text-xs">
                  {mapLabel(map.mapName)}
                </TabsTrigger>
              ))}
            </TabsList>
            {maps.map((map) => (
              <TabsContent key={map.id} value={map.id}>
                <Panel pad={16} className="space-y-3">
                  {/* 地图 info bar */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-fg-mid)] w-5">
                        #{map.mapOrder}
                      </span>
                      <span className="font-medium text-[var(--color-fg)]">
                        {mapLabel(map.mapName)}
                      </span>
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
                  {/* 玩家数据 / OCR */}
                  {isFinished && (
                    <PlayerStatsTable matchId={match.id} mapId={map.id} />
                  )}
                  {!isFinished && map.scoreA == null && (
                    <p className="text-xs text-[var(--color-fg-dim)] py-2">
                      比赛未开始
                    </p>
                  )}
                  {isFinished && isSeasonAdmin && (
                    <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
                  )}
                </Panel>
              </TabsContent>
            ))}
          </Tabs>
        </section>
      ) : isFinished && match.scoreA != null && match.scoreB != null ? (
        // BO1 fallback (from Phase 1)
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛结果</h2>
          <Panel pad={16}>
            <p className="text-sm text-[var(--color-fg-mid)]">
              {MATCH_FORMAT_LABELS[match.format] ?? match.format.toUpperCase()} 系列赛总分：{match.scoreA} : {match.scoreB}
            </p>
          </Panel>
        </section>
      ) : null}

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
                scheduledAt={match.scheduledAt}
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
              hasSubmittedRoster={captainRoster?.status === "submitted"}
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
          completedAt={match.completedAt?.toISOString() ?? null}
        />
      )}
    </div>
  );
}
