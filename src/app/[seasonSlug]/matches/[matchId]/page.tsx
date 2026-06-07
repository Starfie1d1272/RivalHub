import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { MatchWorkspace } from "@cs2dak/react";
import { getCurrentMatchWorkspace } from "@/actions/dak-analysis";
import { getMatchRoster } from "@/actions/matches/roster";
import { getTimeProposals } from "@/actions/matches/scheduling";
import { MatchHeadToHead } from "@/components/matches/MatchHeadToHead";
import { MatchHeroHeader } from "@/components/matches/MatchHeroHeader";
import { MapPoolRadarChart } from "@/components/matches/MapPoolRadarChart";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";
import { MatchRosterView } from "@/components/matches/MatchRosterView";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
import { TimeProposalHistory } from "@/components/matches/TimeProposalHistory";
import { VetoView } from "@/components/matches/VetoView";
import { Panel, PosChip } from "@/components/rivalhub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/db/client";
import { matchMaps, matches, seasonRegistrations, seasons, teamMembers, teams, users } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { buildRadarData, buildRoster, type RosterPlayer } from "@/lib/matches/detail-stats";
import { getSeasonFinishedMatches } from "@/lib/matches/detail-data";
import { getTimeBufferHoursForStage } from "@/lib/matches/time-rules";
import { mapLabel } from "@/lib/maps";
import { getTeamBanStats, getTeamMapWinStats, getTeamPickStats } from "@/lib/teams/data";
import { normalizeRegistrationConfig } from "@/types/season";
import { SIDE_LABELS } from "@/types/match";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;
  const [season, match] = await Promise.all([
    db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) }),
    db.query.matches.findFirst({ where: eq(matches.id, matchId) }),
  ]);
  if (!season || !match || match.seasonId !== season.id) notFound();

  const [teamA, teamB, maps, timeProposals, rosterA, rosterB, userSession, allTeamMembers, seasonMatchesA, seasonMatchesB] = await Promise.all([
    db.query.teams.findFirst({ where: eq(teams.id, match.teamAId) }),
    db.query.teams.findFirst({ where: eq(teams.id, match.teamBId) }),
    db.query.matchMaps.findMany({ where: eq(matchMaps.matchId, matchId), orderBy: (table, { asc }) => [asc(table.mapOrder)] }),
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

  const isFinished = match.status === "finished";
  const finishedMaps = maps.filter((map) => map.scoreA !== null && map.scoreB !== null);
  const workspaceByMapId = new Map<string, Awaited<ReturnType<typeof getCurrentMatchWorkspace>>>();
  if (isFinished) {
    const workspaces = await Promise.all(finishedMaps.map((map) => getCurrentMatchWorkspace(map.id)));
    finishedMaps.forEach((map, index) => workspaceByMapId.set(map.id, workspaces[index]));
  }

  const h2hMatches = seasonMatchesA
    .filter((seasonMatch) => seasonMatch.teamAId === match.teamBId || seasonMatch.teamBId === match.teamBId)
    .slice(0, 10)
    .map((seasonMatch) => {
      const aIsTeamA = seasonMatch.teamAId === match.teamAId;
      const scoreA = aIsTeamA ? (seasonMatch.scoreA ?? 0) : (seasonMatch.scoreB ?? 0);
      const scoreB = aIsTeamA ? (seasonMatch.scoreB ?? 0) : (seasonMatch.scoreA ?? 0);
      return {
        matchId: seasonMatch.id,
        scheduledAt: seasonMatch.scheduledAt,
        completedAt: seasonMatch.completedAt,
        stage: seasonMatch.stage,
        format: seasonMatch.format,
        scoreA,
        scoreB,
        teamAWon: scoreA > scoreB,
      };
    });

  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
  const [mapWinA, mapWinB, pickStatsA, pickStatsB, banStatsA, banStatsB] = await Promise.all([
    getTeamMapWinStats(match.teamAId, seasonMatchesA),
    getTeamMapWinStats(match.teamBId, seasonMatchesB),
    getTeamPickStats(match.teamAId, seasonMatchesA.map((seasonMatch) => seasonMatch.id)),
    getTeamPickStats(match.teamBId, seasonMatchesB.map((seasonMatch) => seasonMatch.id)),
    getTeamBanStats(match.teamAId, seasonMatchesA.map((seasonMatch) => seasonMatch.id)),
    getTeamBanStats(match.teamBId, seasonMatchesB.map((seasonMatch) => seasonMatch.id)),
  ]);

  let isCaptainA = false;
  let isCaptainB = false;
  let isSeasonAdmin = false;
  let captainTeamMembers: { id: string; steamName: string; displayName: string | null; perfectName: string | null; primaryPosition: string }[] = [];
  if (userSession?.userId) {
    isSeasonAdmin = userSession.role === "super_admin" || (userSession.role === "season_admin" && userSession.adminSeasonIds.includes(season.id));
    const registration = await db.query.seasonRegistrations.findFirst({
      where: and(eq(seasonRegistrations.userId, userSession.userId), eq(seasonRegistrations.seasonId, season.id)),
    });
    if (registration) {
      isCaptainA = teamA?.captainRegistrationId === registration.id;
      isCaptainB = teamB?.captainRegistrationId === registration.id;
      const captainTeamId = isCaptainA ? match.teamAId : isCaptainB ? match.teamBId : null;
      if (captainTeamId) {
        captainTeamMembers = allTeamMembers.filter((member) => member.teamId === captainTeamId).map((member) => ({
          id: member.id,
          steamName: member.steamName ?? "未知",
          displayName: member.displayName,
          perfectName: member.perfectName,
          primaryPosition: member.primaryPosition,
        }));
      }
    }
  }

  const captainRoster = isCaptainA ? rosterA : isCaptainB ? rosterB : null;
  const teamARoster: RosterPlayer[] | null = rosterA ? buildRoster(rosterA, allTeamMembers, match.teamAId) : null;
  const teamBRoster: RosterPlayer[] | null = rosterB ? buildRoster(rosterB, allTeamMembers, match.teamBId) : null;
  const visibleMaps = isFinished ? finishedMaps : maps;
  const firstWorkspaceMap = finishedMaps.find((map) => {
    const result = workspaceByMapId.get(map.id);
    return result?.success && result.data;
  });

  return (
    <div className="container mx-auto max-w-3xl space-y-8 px-4 py-12">
      <MatchHeroHeader seasonSlug={seasonSlug} match={match} teamA={teamA} teamB={teamB} isFinished={isFinished} />

      {!isFinished && mapPool.length > 0 && (
        <Panel label="地图池">
          <MapPoolRadarChart
            mapPool={mapPool}
            teamAName={teamA?.name ?? "A"}
            teamBName={teamB?.name ?? "B"}
            teamAData={buildRadarData(mapPool, mapWinA, pickStatsA, banStatsA)}
            teamBData={buildRadarData(mapPool, mapWinB, pickStatsB, banStatsB)}
          />
        </Panel>
      )}

      {!isFinished && (
        <MatchHeadToHead
          teamAName={teamA?.name ?? "队伍 A"}
          teamBName={teamB?.name ?? "队伍 B"}
          teamAWins={h2hMatches.filter((item) => item.teamAWon).length}
          teamBWins={h2hMatches.filter((item) => !item.teamAWon).length}
          matches={h2hMatches}
          seasonSlug={seasonSlug}
        />
      )}

      {match.status !== "scheduled" && (
        <VetoView matchId={match.id} teamAName={teamA?.name ?? "队伍 A"} teamBName={teamB?.name ?? "队伍 B"} teamAId={match.teamAId} teamBId={match.teamBId} />
      )}

      {visibleMaps.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">地图结果</h2>
          <Tabs defaultValue={firstWorkspaceMap?.id ?? visibleMaps[0]?.id}>
            <TabsList>
              {visibleMaps.map((map) => <TabsTrigger key={map.id} value={map.id}>{mapLabel(map.mapName)}</TabsTrigger>)}
            </TabsList>
            {visibleMaps.map((map) => {
              const workspace = workspaceByMapId.get(map.id);
              return (
                <TabsContent key={map.id} value={map.id} className="space-y-3">
                  <Panel pad={16}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-[var(--color-fg-mid)]">#{map.mapOrder}</span>
                        <span className="font-medium">{mapLabel(map.mapName)}</span>
                        {map.pickedByTeamId === match.teamAId && <PosChip pos={`${teamA?.name} Pick`} />}
                        {map.pickedByTeamId === match.teamBId && <PosChip pos={`${teamB?.name} Pick`} />}
                      </div>
                      <div className="text-sm">
                        {map.teamAStartSide && <span className="mr-3 text-[var(--color-fg-mid)]">{teamA?.name} {SIDE_LABELS[map.teamAStartSide]}先</span>}
                        {map.scoreA !== null && map.scoreB !== null && <strong className="font-mono">{map.scoreA} : {map.scoreB}</strong>}
                      </div>
                    </div>
                  </Panel>
                  {workspace?.success && workspace.data ? (
                    <MatchWorkspace model={workspace.data} />
                  ) : isFinished ? (
                    <Panel pad={16}><p className="text-sm text-[var(--color-fg-mid)]">该地图尚未生成 DAK 分析快照。</p></Panel>
                  ) : (
                    <Panel pad={16}><p className="text-sm text-[var(--color-fg-mid)]">比赛未开始。</p></Panel>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </section>
      )}

      {!isFinished && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">赛前名单</h2>
          <Panel pad={16}>
            <MatchRosterView teamAName={teamA?.name ?? "队伍 A"} teamARoster={teamARoster} teamBName={teamB?.name ?? "队伍 B"} teamBRoster={teamBRoster} />
          </Panel>
          {(isCaptainA || isCaptainB) && (
            <Panel pad={16}>
              <MatchRosterForm matchId={match.id} teamMembers={captainTeamMembers} hasExistingRoster={captainRoster?.status === "submitted"} scheduledAt={match.scheduledAt} />
            </Panel>
          )}
        </section>
      )}

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
          <Panel pad={16}><TimeProposalHistory proposals={timeProposals} /></Panel>
        </section>
      )}
    </div>
  );
}
