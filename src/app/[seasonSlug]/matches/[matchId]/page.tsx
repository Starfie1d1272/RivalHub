import React from "react";
import { MatchLiveViewing } from "@/components/matches/MatchLiveViewing";
import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, and, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  matches,
  competitionEntries,
  eventRosters,
  eventRosterMembers,
  matchCommentators,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  steamProfiles,
  users,
  seasonRegistrations,
} from "@/db/schema";
import { matchMvpVotes } from "@/db/schema/mvp-votes";
import { MatchMvpVote } from "@/components/matches/MatchMvpVote";
import { PageLayout, Panel, PosChip } from "@/components/rivalhub";
import { mapLabel } from "@/lib/maps";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { MATCH_FORMAT_LABELS, SIDE_LABELS } from "@/types/match";
import { TimeProposalHistory } from "@/components/matches/TimeProposalHistory";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
import { MatchRosterView } from "@/components/matches/MatchRosterView";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";
import { VetoView } from "@/components/matches/VetoView";
import { MatchMapProfile } from "@/components/matches/MatchMapProfile";
import { MatchHeadToHead } from "@/components/matches/MatchHeadToHead";
import { MatchRecentResults } from "@/components/matches/MatchRecentResults";
import { MatchSummaryStats, type SummaryPlayer } from "@/components/matches/MatchSummaryStats";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
import { getMatchMvpResults, ensureMvpWinner } from "@/actions/player-stats";
import { getMatchTimeProposalViews } from "@/lib/matches/time-proposals";
import { getTimeBufferHoursForStage } from "@/lib/matches/time-rules";
import { getMatchRoster } from "@/actions/matches/roster";
import { getUserSession, requireSeasonAdmin } from "@/lib/auth/session";
import { isExpectedAuthFailure } from "@/lib/errors";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import {
  buildRoster,
  type RosterPlayer,
} from "@/lib/matches/detail-stats";
import { loadMatchPreAnalysis } from "@/lib/matches/pre-analysis";
import { loadMatchScoreboard } from "@/lib/matches/detail-scoreboard";
import { canConfirmMapScoreboard } from "@/lib/matches/map-scoreboard";
import { MatchHeroHeader } from "@/components/matches/MatchHeroHeader";
import { MatchMapTabsNavigation } from "@/components/matches/MatchMapTabsNavigation";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { supportsRegistrationPositionDirectory } from "@/lib/players/directory-query";
import { isHttpUrl } from "@/lib/external-url";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getMatchPlayerDetail } from "@/lib/stats/tournament-query";
import { PlayerWorkspace } from "@/components/stats/players/PlayerWorkspace";
import { loadMatchPrediction } from "@/lib/matches/prediction-read-model";
import { MatchPrediction } from "@/components/matches/MatchPrediction";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
  searchParams: Promise<{ statsPlayer?: string; statsMap?: string }>;
}

export default async function MatchDetailPage({ params, searchParams }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;
  const statsQuery = await searchParams;

  const [season, match] = await Promise.all([
    getPublicOrAuthorizedDraftSeason(seasonSlug),
    db.query.matches.findFirst({ where: eq(matches.id, matchId) }),
  ]);
  if (!season) notFound();
  if (!match || match.seasonId !== season.id) notFound();

  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;

  const [teamA, teamB, maps] = await Promise.all([
    db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, match.entryAId) }),
    db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, match.entryBId) }),
    db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, matchId),
      orderBy: (t, { asc }) => [asc(t.mapOrder)],
    }),
  ]);

  const isFinished = match.status === "finished";
  const hasCompletedMaps = maps.some(canConfirmMapScoreboard);

  // PRE scouting is queried only for matches that have not finished and have no completed map yet.
  // POST scoreboard is queried only when finished or when maps have been completed.
  const needPreAnalysis = !isFinished && !hasCompletedMaps;
  const needScoreboard = isFinished || hasCompletedMaps;

  const userSession = await getUserSession();

  const [
    rosterA,
    rosterB,
    allTeamMemberRows,
    preAnalysis,
    commentatorRows,
    prediction,
    timeProposals,
  ] = await Promise.all([
    getMatchRoster(match.id, match.entryAId),
    getMatchRoster(match.id, match.entryBId),
    db
      .select({
        id: eventRosterMembers.id,
        teamId: eventRosters.entryId,
        personaName: steamProfiles.personaName,
        displayName: users.displayName,
        perfectName: users.perfectName,
        userId: users.id,
        avatarUrl: steamProfiles.avatarUrl,
        isCurrent: eventRosterMembers.isCurrent,
      })
      .from(eventRosterMembers)
      .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
      .innerJoin(users, eq(eventRosterMembers.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(and(
        inArray(eventRosters.entryId, [match.entryAId, match.entryBId]),
        or(
          eq(eventRosterMembers.isCurrent, true),
          inArray(eventRosterMembers.id, db.select({ memberId: matchRosterPlayers.eventRosterMemberId })
            .from(matchRosterPlayers)
            .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
            .where(eq(matchRosters.matchId, match.id))),
        ),
      )),
    needPreAnalysis
      ? loadMatchPreAnalysis(season.id, match.entryAId, match.entryBId, mapPool)
      : null,
    db.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, liveStreamUrl: users.liveStreamUrl })
      .from(matchCommentators)
      .innerJoin(users, eq(matchCommentators.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(matchCommentators.matchId, match.id)),
    !isFinished
      ? loadMatchPrediction(match.id, season.id, match.scheduledAt, userSession?.userId ?? null)
      : null,
    getMatchTimeProposalViews(match.id, userSession?.userId),
  ]);

  const registrationPositions = supportsRegistrationPositionDirectory(season.competitionTemplate)
    ? await db.select({ userId: seasonRegistrations.userId, position: seasonRegistrations.primaryPosition })
      .from(seasonRegistrations)
      .where(and(eq(seasonRegistrations.seasonId, season.id), inArray(seasonRegistrations.userId, allTeamMemberRows.map((row) => row.userId))))
    : [];
  const positionByUserId = new Map(registrationPositions.map((row) => [row.userId, row.position]));
  const allTeamMembers = allTeamMemberRows.map((row) => ({
    ...row,
    primaryPosition: positionByUserId.get(row.userId) ?? "",
  }));

  const mapProfileRows = preAnalysis?.mapProfileRows ?? [];
  const recentResultsA = preAnalysis?.recentResultsA ?? [];
  const recentResultsB = preAnalysis?.recentResultsB ?? [];
  const h2hMatches = preAnalysis?.h2hMatches ?? [];
  const h2hWinsA = preAnalysis?.h2hWinsA ?? 0;
  const h2hWinsB = preAnalysis?.h2hWinsB ?? 0;

  // 建立 userId 集合
  const matchRosterMemberIds = new Set([
    ...(rosterA?.players.map((player) => player.eventRosterMemberId) ?? []),
    ...(rosterB?.players.map((player) => player.eventRosterMemberId) ?? []),
  ]);
  const userIdToTeamId = new Map<string, string>(
    allTeamMembers.filter((m) => m.userId && m.isCurrent).map((m) => [m.userId as string, m.teamId]),
  );
  const userIdToMember = new Map(
    allTeamMembers.filter((m) => m.userId && m.isCurrent).map((m) => [m.userId as string, m]),
  );
  for (const member of allTeamMembers) {
    if (!member.userId || !matchRosterMemberIds.has(member.id)) continue;
    userIdToTeamId.set(member.userId, member.teamId);
    userIdToMember.set(member.userId, member);
  }

  // 队长 / 管理员权限检查
  let isCaptainA = false;
  let isCaptainB = false;
  let isSeasonAdmin = false;
  let captainTeamMembers: { id: string; personaName: string | null; avatarUrl: string | null; displayName: string | null; perfectName: string | null; primaryPosition: string }[] = [];

  if (userSession?.userId) {
    try {
      await requireSeasonAdmin(season.id);
      isSeasonAdmin = true;
    } catch (error) {
      if (!isExpectedAuthFailure(error)) throw error;
      isSeasonAdmin = false;
    }

    isCaptainA = teamA?.representativeUserId === userSession.userId;
    isCaptainB = teamB?.representativeUserId === userSession.userId;
    if (isCaptainA || isCaptainB) {
      const captainTeamId = isCaptainA ? match.entryAId : match.entryBId;
      captainTeamMembers = allTeamMembers
        .filter((m) => m.teamId === captainTeamId && m.isCurrent)
        .map((r) => ({
          id: r.id,
          personaName: r.personaName ?? null,
          avatarUrl: r.avatarUrl,
          displayName: r.displayName ?? null,
          perfectName: r.perfectName ?? null,
          primaryPosition: r.primaryPosition,
        }));
    }
  }

  const captainRoster = isCaptainA ? rosterA : isCaptainB ? rosterB : null;
  const teamARoster: RosterPlayer[] | null = rosterA
    ? buildRoster(rosterA, allTeamMembers, match.entryAId)
    : null;
  const teamBRoster: RosterPlayer[] | null = rosterB
    ? buildRoster(rosterB, allTeamMembers, match.entryBId)
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
    avatarUrl: string | null;
  }[] = [];
  let mvpVoteResults: Awaited<ReturnType<typeof getMatchMvpResults>> = [];
  let userVoted: string | null = null;
  let summaryPlayers: SummaryPlayer[] = [];

  const scoreboard = needScoreboard
    ? await loadMatchScoreboard(match, maps, userIdToTeamId)
    : null;

  let detailed: Awaited<ReturnType<typeof getMatchPlayerDetail>> = null;
  let detailedPlayerId: string | null = null;
  let detailedMap: (typeof maps)[number] | undefined = undefined;

  if (scoreboard) {
    summaryPlayers = scoreboard.summaryPlayers;
    detailedPlayerId = scoreboard.detailedPlayerIds.has(statsQuery.statsPlayer ?? "")
      ? statsQuery.statsPlayer!
      : [...scoreboard.detailedPlayerIds][0] ?? null;
    detailedMap = maps.find((map) => map.id === statsQuery.statsMap && scoreboard.detailedMapIds.has(map.id));
    detailed = detailedPlayerId
      ? await getMatchPlayerDetail(match.id, detailedPlayerId, detailedMap?.mapName)
      : null;
  }

  if (isFinished && scoreboard) {
    mvpCandidates = scoreboard.mvpCandidates.map((candidate) => ({
      ...candidate,
      avatarUrl: candidate.userId ? userIdToMember.get(candidate.userId)?.avatarUrl ?? null : null,
    }));

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

  const showSummaryTab = summaryPlayers.length > 0;
  const visibleMaps = maps;
  const defaultTab = showSummaryTab ? "summary" : (visibleMaps[0]?.id ?? "");

  return (
    <PageLayout variant="standard" className="space-y-8">
      <MatchHeroHeader
        seasonSlug={seasonSlug}
        match={match}
        teamA={teamA}
        teamB={teamB}
        isFinished={isFinished}
      />

      {/* 赛前管理员 / 队长聚焦赛务弹窗 */}
      {((isCaptainA || isCaptainB || isSeasonAdmin) && match.status === "scheduled") && (
        <Panel contentClassName="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">你的赛务</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
            {(isCaptainA || isCaptainB || isSeasonAdmin) && (
              <Dialog>
                <DialogTrigger className="min-h-10 rounded border border-[var(--color-border)] px-3 text-sm">
                  约定比赛时间
                </DialogTrigger>
                <DialogContent size="lg">
                  <DialogHeader>
                    <DialogTitle>比赛时间</DialogTitle>
                  </DialogHeader>
                  <DialogBody>
                    <MatchTimeNegotiation
                      matchId={match.id}
                      isCaptainA={isCaptainA}
                      isCaptainB={isCaptainB}
                      isAdmin={isSeasonAdmin}
                      currentScheduledAt={match.scheduledAt}
                      currentCompletionDeadline={match.completionDeadline}
                      initialProposals={timeProposals}
                      hasSubmittedRoster={captainRoster?.status === "submitted"}
                      bufferHours={getTimeBufferHoursForStage(season.stagePlan, match.stage)}
                    />
                    <div className="mt-6">
                      <h3 className="mb-2 text-sm font-medium">协商历史</h3>
                      <TimeProposalHistory proposals={timeProposals} />
                    </div>
                  </DialogBody>
                </DialogContent>
              </Dialog>
            )}
            {(isCaptainA || isCaptainB) && captainRoster && (
              <Dialog>
                <DialogTrigger className="min-h-10 rounded border border-[var(--color-border)] px-3 text-sm">
                  调整本场首发
                </DialogTrigger>
                <DialogContent size="lg">
                  <DialogHeader>
                    <DialogTitle>调整本场首发</DialogTitle>
                  </DialogHeader>
                  <DialogBody>
                    <MatchRosterForm
                      matchId={match.id}
                      teamMembers={captainTeamMembers}
                      hasExistingRoster={Boolean(captainRoster)}
                      matchStatus={match.status}
                      rosterStatus={captainRoster?.status ?? null}
                      initialStarterIds={captainRoster?.players.filter((player) => player.isStarter).map((player) => player.eventRosterMemberId) ?? []}
                      initialSubstituteIds={captainRoster?.players.filter((player) => !player.isStarter).map((player) => player.eventRosterMemberId) ?? []}
                      initialVetoRepresentativeEventRosterMemberId={captainRoster?.players.find((player) => player.isVetoRepresentative)?.eventRosterMemberId ?? null}
                      allowSubstitutes={match.ownership !== "major_stage"}
                    />
                  </DialogBody>
                </DialogContent>
              </Dialog>
            )}
            <Link className="inline-flex min-h-10 items-center rounded border border-[var(--color-border)] px-3 text-sm" href={`/${seasonSlug}/matches/${match.id}/veto`}>
              进入 BP 房间
            </Link>
          </div>
        </Panel>
      )}

      <MatchLiveViewing status={match.status} commentators={commentatorRows} />
      {prediction && (
        <MatchPrediction
          data={prediction}
          teamAName={teamA?.name ?? "队伍 A"}
          teamBName={teamB?.name ?? "队伍 B"}
          entryAId={match.entryAId}
          seasonSlug={seasonSlug}
        />
      )}

      {/* 赛前分析与预备信息（未结束时展示） */}
      {!isFinished && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--color-fg)]">本场阵容</h2>
            <Panel contentClassName="p-4">
              <MatchRosterView
                teamAName={teamA?.name ?? "队伍 A"}
                teamARoster={teamARoster}
                teamBName={teamB?.name ?? "队伍 B"}
                teamBRoster={teamBRoster}
              />
            </Panel>
          </section>

          {mapProfileRows.length > 0 && (
            <MatchMapProfile
              rows={mapProfileRows}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
            />
          )}

          {(recentResultsA.length > 0 || recentResultsB.length > 0) && (
            <MatchRecentResults
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              teamA={recentResultsA}
              teamB={recentResultsB}
              seasonSlug={seasonSlug}
            />
          )}

          {h2hMatches.length > 0 && (
            <MatchHeadToHead
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              teamAWins={h2hWinsA}
              teamBWins={h2hWinsB}
              matches={h2hMatches}
              seasonSlug={seasonSlug}
            />
          )}

          <section className="space-y-3">
            <Panel label="BP 与开赛">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--color-fg)]">Veto Room</h2>
                  <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                    {match.status === "scheduled"
                      ? "双方负责人确认后开始 BP；Veto Session 开始时比赛进入进行中。"
                      : "查看当前禁选进度、倒计时与超时记录。"}
                  </p>
                </div>
                <Link
                  className="inline-flex min-h-10 items-center rounded border border-[var(--color-border)] px-4 text-sm font-medium hover:border-[var(--color-border-hover)]"
                  href={`/${seasonSlug}/matches/${match.id}/veto`}
                >
                  {match.status === "scheduled" ? "打开 Veto Room" : "查看 Veto Room"}
                </Link>
              </div>
            </Panel>
          </section>

          {match.status !== "scheduled" && (
            <VetoView
              matchId={match.id}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
            />
          )}
        </>
      )}

      {/* 地图结果 */}
      {maps.length > 0 ? (
        <section className="min-w-0 space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">地图结果</h2>
          <Tabs defaultValue={defaultTab}>
            <MatchMapTabsNavigation
              maps={visibleMaps}
              showSummaryTab={showSummaryTab}
              teamAId={match.entryAId}
              teamBId={match.entryBId}
              teamAName={teamA?.name}
              teamBName={teamB?.name}
            />

            {/* 整场汇总 Tab */}
            {showSummaryTab && (
              <TabsContent value="summary">
                <MatchSummaryStats
                  players={summaryPlayers}
                  entryAId={match.entryAId}
                  entryBId={match.entryBId}
                  teamAName={teamA?.name ?? "队伍 A"}
                  teamBName={teamB?.name ?? "队伍 B"}
                />
              </TabsContent>
            )}

            {/* 单图 Tab */}
            {visibleMaps.map((map) => (
              <TabsContent key={map.id} value={map.id}>
                <Panel contentClassName="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--color-fg-mid)] w-5">#{map.mapOrder}</span>
                      <span className="font-medium text-[var(--color-fg)]">{mapLabel(map.mapName)}</span>
                      {map.pickedByEntryId === match.entryAId && <PosChip pos={`${teamA?.name} Pick`} />}
                      {map.pickedByEntryId === match.entryBId && <PosChip pos={`${teamB?.name} Pick`} />}
                      {map.pickedByEntryId === null && <PosChip pos="决胜图" />}
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
                  {scoreboard?.confirmedMapIds.has(map.id) && (
                    <PlayerStatsTable
                      players={scoreboard.mapPlayers.get(map.id) ?? []}
                      entryAId={match.entryAId}
                      entryBId={match.entryBId}
                      teamAName={teamA?.name ?? "队伍 A"}
                      teamBName={teamB?.name ?? "队伍 B"}
                    />
                  )}
                  {map.scoreA === null && <p className="text-xs text-[var(--color-fg-dim)] py-2">地图待进行</p>}
                </Panel>
              </TabsContent>
            ))}
          </Tabs>
        </section>
      ) : isFinished && match.scoreA != null && match.scoreB != null ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">比赛结果</h2>
          {match.isForfeit ? (
            <Panel contentClassName="p-4">
              <p className="text-sm text-[var(--color-fg-mid)]">
                本场比赛以弃赛结束，未进行实际对局。
              </p>
            </Panel>
          ) : summaryPlayers.length > 0 ? (
            <MatchSummaryStats
              players={summaryPlayers}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
            />
          ) : (
            <Panel contentClassName="p-4">
              <p className="text-sm text-[var(--color-fg-mid)]">
                {MATCH_FORMAT_LABELS[match.format] ?? match.format.toUpperCase()} 系列赛总分：{match.scoreA} : {match.scoreB}
              </p>
            </Panel>
          )}
        </section>
      ) : null}

      {/* 详细统计 */}
      {detailed && detailedPlayerId && (
        <section id="detailed-stats" className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold">详细统计</h2>
          <nav aria-label="统计范围" className="flex flex-wrap gap-2">
            <Link
              href={`/${seasonSlug}/matches/${match.id}?statsPlayer=${detailedPlayerId}#detailed-stats`}
              aria-current={!detailedMap ? "page" : undefined}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm aria-[current=page]:border-[var(--color-accent)]"
            >
              整场汇总
            </Link>
            {scoreboard?.completed
              .filter((map) => scoreboard.detailedMapIds.has(map.id))
              .map((map) => (
                <Link
                  key={map.id}
                  href={`/${seasonSlug}/matches/${match.id}?statsPlayer=${detailedPlayerId}&statsMap=${map.id}#detailed-stats`}
                  aria-current={detailedMap?.id === map.id ? "page" : undefined}
                  className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm aria-[current=page]:border-[var(--color-accent)]"
                >
                  {mapLabel(map.mapName)}
                </Link>
              ))}
          </nav>
          <nav aria-label="选手" className="flex flex-wrap gap-2">
            {scoreboard?.detailedPlayers.map((player) => (
              <Link
                key={player.userId}
                href={`/${seasonSlug}/matches/${match.id}?statsPlayer=${player.userId}${detailedMap ? `&statsMap=${detailedMap.id}` : ""}#detailed-stats`}
                aria-current={detailedPlayerId === player.userId ? "page" : undefined}
                className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm aria-[current=page]:border-[var(--color-accent)]"
              >
                {player.name}
              </Link>
            ))}
          </nav>
          <PlayerWorkspace detail={detailed} hideMaps />
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

      {/* 赛后 BP 流程与最终名单 */}
      {isFinished && (
        <>
          <div className="flex justify-end">
            <Link className="text-sm text-[var(--color-accent)] hover:underline" href={`/${seasonSlug}/matches/${match.id}/veto`}>
              打开 Veto Room 记录
            </Link>
          </div>
          {match.status !== "scheduled" && (
            <VetoView
              matchId={match.id}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
            />
          )}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--color-fg)]">本场阵容</h2>
            <Panel contentClassName="p-4">
              <MatchRosterView
                teamAName={teamA?.name ?? "队伍 A"}
                teamARoster={teamARoster}
                teamBName={teamB?.name ?? "队伍 B"}
                teamBRoster={teamBRoster}
              />
            </Panel>
          </section>
        </>
      )}

      {/* 赛后录像与解说 */}
      {isFinished && (commentatorRows.length > 0 || (match.videoUrl && isHttpUrl(match.videoUrl))) && (
        <Panel label="录像与解说" contentClassName="space-y-2 p-4">
          {commentatorRows.length > 0 && <p className="text-sm">解说：{commentatorRows.map(getPublicDisplayName).join("、")}</p>}
          {match.videoUrl && isHttpUrl(match.videoUrl) && (
            <a href={match.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-[var(--color-accent)] hover:underline">
              观看比赛录像 →
            </a>
          )}
        </Panel>
      )}
    </PageLayout>
  );
}
