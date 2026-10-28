import { ContentReady } from "@/components/telemetry/ContentReady";
import MatchDetailLoading from "./loading";
import { hasMatchRecording } from "@/lib/postmatch/recording-types";
import { MatchRecordings } from "@/components/matches/MatchRecordings";
import { hasActivePublicSanction } from "@/lib/discipline/public-query";
import { projectDisplayScore } from "@/lib/matches/display-score";
import type { Metadata } from "next";
import { io } from "next/cache";
import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { getPublicPlayerIdentityIds } from "@/lib/players/public-identity";
import React, { cache, Suspense } from "react";
import { MatchBetLink } from "@/components/bet/MatchBetLink";
import { PreMatchContext } from "@/components/matches/PreMatchContext";
import { MatchContextRefresh } from "@/components/matches/MatchContextRefresh";
import { MatchLiveProvider } from "@/components/matches/MatchLiveProvider";
import { MatchRealtime } from "@/components/matches/MatchRealtime";
import { MatchMapSequence } from "@/components/matches/MatchMapSequence";
import { loadPublicMatchPhase } from "@/lib/matches/public-phase";
import { readBilibiliStatus } from "@/lib/production/bilibili";
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
import { MatchMvpVote, type MvpPerformance } from "@/components/matches/MatchMvpVote";
import { PageLayout, Panel, PosChip } from "@/components/rivalhub";
import { mapLabel } from "@/lib/maps";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { MATCH_FORMAT_LABELS, SIDE_LABELS } from "@/types/match";
import { TimeProposalHistory } from "@/components/matches/TimeProposalHistory";
import { MatchTimeNegotiation } from "@/components/matches/MatchTimeNegotiation";
import { MatchRosterView } from "@/components/matches/MatchRosterView";
import { MatchLineupComparison } from "@/components/matches/MatchLineupComparison";
import { lineupComparisonCutoff, resolveLineup } from "@/lib/matches/lineup-comparison";
import { getLineupCareers } from "@/lib/matches/lineup-comparison-query";
import { MatchRosterForm } from "@/components/matches/MatchRosterForm";
import { VetoView } from "@/components/matches/VetoView";
import { MatchMapProfile } from "@/components/matches/MatchMapProfile";
import { MatchHeadToHead } from "@/components/matches/MatchHeadToHead";
import { MatchRecentResults } from "@/components/matches/MatchRecentResults";
import { MatchSummaryStats, type SummaryPlayer } from "@/components/matches/MatchSummaryStats";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
import { getMatchMvpResults } from "@/actions/player-stats";
import { getMatchTimeProposalViews } from "@/lib/matches/time-proposals";
import { projectMatchScheduling } from "@/lib/matches/time-rules";
import { presentMatchStage, presentSchedulingAction } from "@/lib/matches/presentation";
import { loadMatchRosters } from "@/lib/match-rosters/read-model";
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
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getPublicMatchPlayerDetail, getPublicMatchMvpSummary } from "@/lib/stats/cached-query";
import { readOptionalPublicStats } from "@/lib/stats/availability";
import { PlayerWorkspace } from "@/components/stats/players/PlayerWorkspace";

interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
  searchParams: Promise<{ statsPlayer?: string; statsMap?: string; scheduling?: string }>;
}

const loadPlayerDetail = cache(getPublicMatchPlayerDetail);

const loadMatch = cache((matchId: string) => db.query.matches.findFirst({ where: eq(matches.id, matchId) }));

export async function generateMetadata({ params }: MatchDetailPageProps): Promise<Metadata> {
  await io();
  const { matchId } = await params;
  const match = await loadMatch(matchId);
  return match?.testConfig ? { robots: { index: false, follow: false } } : {};
}

async function loadMatchCore(params: MatchDetailPageProps["params"]) {
  await io();
  const { seasonSlug, matchId } = await params;

  const [season, match] = await Promise.all([
    getPublicOrAuthorizedDraftSeason(seasonSlug),
    loadMatch(matchId),
  ]);
  if (!season) notFound();
  if (!match || match.seasonId !== season.id) notFound();
  assertCompetitionMatch(match);

  const [teams, maps] = await Promise.all([
    db.query.competitionEntries.findMany({ where: and(eq(competitionEntries.competitionId, season.id), inArray(competitionEntries.id, [match.entryAId, match.entryBId])) }),
    db.query.matchMaps.findMany({
      where: eq(matchMaps.matchId, matchId),
      orderBy: (t, { asc }) => [asc(t.mapOrder)],
    }),
  ]);

  const teamA = teams.find(team => team.id === match.entryAId);
  const teamB = teams.find(team => team.id === match.entryBId);
  return { seasonSlug, season, match, teamA, teamB, maps };
}

type MatchCore = Awaited<ReturnType<typeof loadMatchCore>>;

export default function MatchDetailPage(props: MatchDetailPageProps) {
  return <Suspense fallback={<MatchDetailLoading />}><MatchDetailShell {...props} /></Suspense>;
}

async function MatchDetailShell({ params, searchParams }: MatchDetailPageProps) {
  const core = await loadMatchCore(params);
  const { seasonSlug, season, match, teamA, teamB, maps } = core;
  return <PageLayout variant="wide" className="space-y-8">
    {match.testConfig && <p className="text-sm text-[var(--color-fg-mid)]">测试赛 · 不计入正式赛程与统计</p>}
    <MatchContextRefresh enabled={match.status === "scheduled" || match.status === "in_progress"} seasonSlug={seasonSlug} scope={{ matchId: match.id }} />
    <MatchHeroHeader seasonSlug={seasonSlug} stageName={presentMatchStage(match.stage, season.stagePlan)}
      match={{ ...match, displayScore: projectDisplayScore(match, maps) }} teamA={teamA} teamB={teamB} isFinished={match.status === "finished"} />
    <Suspense fallback={<div role="status" className="min-h-80 text-sm text-[var(--color-fg-mid)]">比赛内容加载中…</div>}>
      <MatchDetailContent core={core} searchParams={searchParams} />
    </Suspense>
  </PageLayout>;
}

async function MatchDetailContent({ core, searchParams }: { core: MatchCore; searchParams: MatchDetailPageProps["searchParams"] }) {
  const { seasonSlug, season, match, teamA, teamB, maps } = core;
  const statsQuery = await searchParams;
  const mapPool = match.testConfig?.mapPool ?? normalizeRegistrationConfig(season.registrationConfig).mapPool;
  const preAnalysisRead = match.status !== "finished"
    ? (async () => loadMatchPreAnalysis(season.id, match.entryAId, match.entryBId, mapPool))() : Promise.resolve(null);
  const [publicContext, userSession] = await Promise.all([loadPublicMatchPhase(match, maps), getUserSession()]);
  const adminRead = userSession && (match.status === "scheduled" || match.status === "in_progress") ? requireSeasonAdmin(season.id).then(() => true).catch(error => {
    if (!isExpectedAuthFailure(error)) throw error;
    return false;
  }) : Promise.resolve(false);
  const phase = publicContext.phase;
  const afterVeto = phase === "awaiting_gameplay" || phase === "gameplay" || phase === "inter_map";
  const isFinished = match.status === "finished";
  const hasReplay = isFinished && hasMatchRecording(match);
  const hasCompletedMaps = maps.some(canConfirmMapScoreboard);

  // Keep scouting available throughout an unfinished match, including loss of live data.
  // POST scoreboard is queried only when finished or when maps have been completed.
  const needScoreboard = isFinished || hasCompletedMaps;

  const [
    rosters,
    allTeamMemberRows,
    commentatorRows,
    timeProposals,
  ] = await Promise.all([
    loadMatchRosters(match.id, [match.entryAId, match.entryBId]),
    db
      .select({
        id: eventRosterMembers.id,
        teamId: eventRosters.entryId,
        personaName: steamProfiles.personaName,
        displayName: users.displayName,
        perfectName: users.perfectName,
        userId: users.id,
        avatarUrl: steamProfiles.avatarUrl,
        hasActivePublicSanction: hasActivePublicSanction(users.id),
        isCurrent: eventRosterMembers.isCurrent,
        isPrimaryStarter: eventRosterMembers.isPrimaryStarter,
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
    db.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName, liveStreamUrl: users.liveStreamUrl })
      .from(matchCommentators)
      .innerJoin(users, eq(matchCommentators.userId, users.id))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(matchCommentators.matchId, match.id)),
    match.status === "scheduled" && userSession
      ? adminRead.then(admin => admin || teamA?.representativeUserId === userSession.userId || teamB?.representativeUserId === userSession.userId
        ? getMatchTimeProposalViews(match.id, userSession.userId) : []) : Promise.resolve([]),
  ]);

  const rosterA = rosters.get(match.entryAId) ?? null;
  const rosterB = rosters.get(match.entryBId) ?? null;
  const commentatorPlayerIds = await getPublicPlayerIdentityIds(db, commentatorRows.map(row => row.userId));
  const publicCommentators = commentatorRows.map(row => ({ ...row, playerUserId: commentatorPlayerIds.has(row.userId) ? row.userId : null }));

  const liveCommentators = await Promise.all(publicCommentators.map(async person => ({
    ...person, broadcastStatus: ["scheduled", "in_progress"].includes(match.status)
      ? await readBilibiliStatus(person.liveStreamUrl, { fresh: true }) : "unknown" as const,
  })));

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

  const scoreboardRead = needScoreboard ? (async () => loadMatchScoreboard(match, maps, userIdToTeamId))() : Promise.resolve(null);

  // 队长 / 管理员权限检查
  let isCaptainA = false;
  let isCaptainB = false;
  let isSeasonAdmin = false;
  let captainTeamMembers: { userId: string; id: string; personaName: string | null; avatarUrl: string | null; displayName: string | null; perfectName: string | null; primaryPosition: string }[] = [];

  if (userSession?.userId) {
    isSeasonAdmin = await adminRead;

    isCaptainA = teamA?.representativeUserId === userSession.userId;
    isCaptainB = teamB?.representativeUserId === userSession.userId;
    if (isCaptainA || isCaptainB) {
      const captainTeamId = isCaptainA ? match.entryAId : match.entryBId;
      captainTeamMembers = allTeamMembers
        .filter((m) => m.teamId === captainTeamId && m.isCurrent)
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          personaName: r.personaName ?? null,
          avatarUrl: r.avatarUrl,
          displayName: r.displayName ?? null,
          perfectName: r.perfectName ?? null,
          primaryPosition: r.primaryPosition,
        }));
    }
  }

  const captainRoster = isCaptainA ? rosterA : isCaptainB ? rosterB : null;
  const canParticipateInVeto = isSeasonAdmin || isCaptainA || isCaptainB || Boolean(userSession && [rosterA, rosterB].some(roster =>
    roster?.players.some(player => player.isVetoRepresentative && player.isStarter && allTeamMembers.some(member => member.id === player.eventRosterMemberId && member.userId === userSession.userId)),
  ));
  const teamARoster: RosterPlayer[] | null = rosterA
    ? buildRoster(rosterA, allTeamMembers, match.entryAId)
    : null;
  const teamBRoster: RosterPlayer[] | null = rosterB
    ? buildRoster(rosterB, allTeamMembers, match.entryBId)
    : null;

  const allowExpected = match.status === "scheduled" && !match.startedAt && !match.gameplayStartedAt;
  const registeredLineup = (entryId: string) => allTeamMembers.filter((member) => member.teamId === entryId && member.isCurrent)
    .map((member) => ({ userId: member.userId, displayName: member.displayName, personaName: member.personaName,
      perfectName: member.perfectName, avatarUrl: member.avatarUrl, hasActivePublicSanction: member.hasActivePublicSanction, isPrimaryStarter: member.isPrimaryStarter, isStarter: member.isPrimaryStarter }));
  const lineupA = resolveLineup(teamARoster, registeredLineup(match.entryAId), allowExpected);
  const lineupB = resolveLineup(teamBRoster, registeredLineup(match.entryBId), allowExpected);
  const comparisonCutoff = lineupComparisonCutoff(match);
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
  let summaryPlayers: SummaryPlayer[] = [];

  const scoreboard = await scoreboardRead;

  summaryPlayers = scoreboard?.summaryPlayers ?? [];
  if (isFinished && scoreboard) {
    mvpCandidates = scoreboard.mvpCandidates.map((candidate) => ({
      ...candidate,
      hasActivePublicSanction: candidate.userId ? userIdToMember.get(candidate.userId)?.hasActivePublicSanction ?? false : false,
      avatarUrl: candidate.userId ? userIdToMember.get(candidate.userId)?.avatarUrl ?? null : null,
    }));

  }

  const pendingTimeProposal = timeProposals.find(proposal => proposal.status === "pending") ?? null;
  const scheduling = projectMatchScheduling(match, pendingTimeProposal);
  const schedulingAction = scheduling.state === "confirmed" ? "查看比赛时间" :
    presentSchedulingAction(scheduling.state, pendingTimeProposal?.isMine);
  const showSummaryTab = summaryPlayers.length > 0;
  const visibleMaps = maps;
  const defaultTab = showSummaryTab ? "summary" : (visibleMaps[0]?.id ?? "");

  const showBpPrimary = phase === "veto" || phase === "awaiting_veto" || phase === "preparation";
  const matchBet = !match.testConfig && season.competitionTemplate === "major" ? (
    <div data-match-bet className="min-h-40">
    <Suspense fallback={<div role="status" className="min-h-40" aria-busy="true">竞猜信息加载中…</div>}>
      <MatchBetLink seasonId={season.id} matchId={match.id} slug={seasonSlug}
        teamA={{ entryId: match.entryAId, name: teamA?.name ?? "队伍 A" }}
        teamB={{ entryId: match.entryBId, name: teamB?.name ?? "队伍 B" }} />
    </Suspense>
    </div>
  ) : null;

  return (
    <>
      {/* 赛前管理员 / 队长聚焦赛务弹窗 */}
      {((isCaptainA || isCaptainB || isSeasonAdmin) && match.status === "scheduled") && (
        <Panel contentClassName="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">你的赛务</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
            {(isCaptainA || isCaptainB || isSeasonAdmin) && (
              <Dialog defaultOpen={statsQuery.scheduling === "1"}>
                <DialogTrigger className="min-h-10 rounded border border-[var(--color-border)] px-3 text-sm">
                  {schedulingAction}
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
                      hasSubmittedRoster={captainRoster?.status === "submitted" || captainRoster?.status === "confirmed"}
                    />
                    <div className="mt-6">
                      <h3 className="mb-2 text-sm font-medium">协商历史</h3>
                      <TimeProposalHistory proposals={timeProposals} />
                    </div>
                  </DialogBody>
                </DialogContent>
              </Dialog>
            )}
            {(isCaptainA || isCaptainB) && (
              <Dialog>
                <DialogTrigger className="min-h-10 rounded border border-[var(--color-border)] px-3 text-sm">
                  {captainRoster ? "调整本场首发" : "选择本场首发"}
                </DialogTrigger>
                <DialogContent size="lg">
                  <DialogHeader>
                    <DialogTitle>{captainRoster ? "调整本场首发" : "选择本场首发"}</DialogTitle>
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

      {(showBpPrimary || (!isFinished && matchBet)) && (
        <div className={`grid min-w-0 gap-4 ${showBpPrimary && matchBet ? "lg:grid-cols-2" : ""}`}>
          {showBpPrimary && <section className="min-w-0" data-testid="match-bp-primary">
            <Panel label="BP 与开赛" className="flex h-full flex-col" contentClassName="flex flex-1 flex-col justify-center">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--color-fg)]">{phase === "veto" ? "BP 进行中" : "等待 BP"}</h2>
                  <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                    {match.status === "scheduled"
                      ? "双方负责人确认后开始地图禁选。"
                      : "查看当前地图禁选进度。"}
                  </p>
                </div>
                <Link
                  className="inline-flex min-h-10 items-center rounded border border-[var(--color-border)] px-4 text-sm font-medium hover:border-[var(--color-border-hover)]"
                  href={`/${seasonSlug}/matches/${match.id}/veto`}
                >
                  {canParticipateInVeto ? "进行 BP" : "查看 BP 进度"}
                </Link>
              </div>
            </Panel>
          </section>}
          {!isFinished && matchBet}
        </div>
      )}
      {showBpPrimary && match.status !== "scheduled" && (
            <VetoView seasonSlug={seasonSlug}
              matchId={match.id}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
            />
      )}
      {(isSeasonAdmin || isCaptainA || isCaptainB) && afterVeto && !isFinished && (
        <Link prefetch={false} className="inline-flex min-h-10 w-fit items-center rounded border border-[var(--color-border)] px-3 text-sm" href={`/${seasonSlug}/matches/${match.id}/veto`}>
          进入 BP 房间
        </Link>
      )}
      <MatchLiveProvider matchId={match.id} eligible={afterVeto}>
      {(afterVeto || isFinished) && maps.length > 0 && <MatchMapSequence seasonSlug={seasonSlug}
        maps={maps.map(map => ({ id: map.id, mapOrder: map.mapOrder, mapName: map.mapName, pickedByEntryId: map.pickedByEntryId, scoreA: map.scoreA, scoreB: map.scoreB, completedAt: map.completedAt?.toISOString() ?? null }))}
        currentMapId={publicContext.currentMapId} entryAId={match.entryAId} entryBId={match.entryBId} phase={phase} seriesProgress={isFinished && match.scoreA !== null && match.scoreB !== null ? { scoreA: match.scoreA, scoreB: match.scoreB } : publicContext.seriesProgress}
        teamAName={teamA?.name ?? "队伍 A"} teamBName={teamB?.name ?? "队伍 B"} finished={isFinished}
      />}
      {(afterVeto || isFinished) && (maps.length > 0 || hasReplay) && (
        <div className="flex flex-wrap items-start gap-3">
          {maps.length > 0 && <details className="min-w-0 flex-1 basis-64 text-sm" data-testid="match-bp-record">
            <summary className="flex min-h-11 w-fit cursor-pointer items-center rounded-sm border border-[var(--color-border)] px-4 text-[var(--color-fg-mid)] hover:border-[var(--color-border-hover)]">BP 记录</summary>
            <div className="mt-3"><VetoView seasonSlug={seasonSlug} matchId={match.id} teamAName={teamA?.name ?? "队伍 A"} teamBName={teamB?.name ?? "队伍 B"} entryAId={match.entryAId} entryBId={match.entryBId} /></div>
          </details>}
          {hasReplay && <MatchRecordings recordings={match.recordings} legacyUrl={match.videoUrl} commentators={publicCommentators.map(person => ({ userId: person.userId, name: getPublicDisplayName(person) }))} />}
        </div>
      )}
      <MatchLiveViewing status={match.status} commentators={liveCommentators} showEmpty={afterVeto} />
      {afterVeto && <MatchRealtime matchId={match.id} phase={phase} currentMapId={publicContext.currentMapId} lastCompletedMap={publicContext.lastCompletedMap} seriesProgress={publicContext.seriesProgress} />}


      {/* 赛前分析与预备信息（未结束时展示） */}
      {!isFinished && (
        <PreMatchContext phase={phase} currentMapId={publicContext.currentMapId}>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--color-fg)]">本场阵容</h2>
            <Panel contentClassName="p-0 overflow-hidden">
              <Suspense fallback={<div aria-busy="true" className="min-h-64 p-4"><p role="status">生涯对照加载中…</p>
                <MatchRosterView entryAId={match.entryAId} entryBId={match.entryBId} teamAName={teamA?.name ?? "队伍 A"} teamBName={teamB?.name ?? "队伍 B"} teamARoster={teamARoster} teamBRoster={teamBRoster} />
              </div>}>
                <MatchLineupDetails
                  a={{ entryId: match.entryAId, name: teamA?.name ?? "队伍 A", logoUrl: teamA?.logoUrl ?? null, ...lineupA }}
                  b={{ entryId: match.entryBId, name: teamB?.name ?? "队伍 B", logoUrl: teamB?.logoUrl ?? null, ...lineupB }}
                  matchId={match.id} cutoff={comparisonCutoff} allowExpected={allowExpected} />
              </Suspense>
            </Panel>
          </section>

          <Suspense fallback={<section role="status" className="min-h-64">赛前分析加载中…</section>}>
            <MatchScouting core={core} analysis={preAnalysisRead} />
          </Suspense>

        </PreMatchContext>
      )}

      </MatchLiveProvider>

      {/* 地图结果 */}
      {maps.length > 0 && (!afterVeto || hasCompletedMaps) ? (
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
                  {scoreboard?.provisionalMapIds.has(map.id) && <p className="text-xs text-[var(--color-fg-dim)]">临时数据，待核对</p>}
                  {(scoreboard?.confirmedMapIds.has(map.id) || scoreboard?.provisionalMapIds.has(map.id)) && (
                    <PlayerStatsTable
                      players={scoreboard.mapPlayers.get(map.id) ?? []}
                      entryAId={match.entryAId}
                      entryBId={match.entryBId}
                      teamAName={teamA?.name ?? "队伍 A"}
                      teamBName={teamB?.name ?? "队伍 B"}
                    />
                  )}
                  {map.scoreA === null && <p className="text-xs text-[var(--color-fg-dim)] py-2">{isFinished ? "本图未进行" : "地图待进行"}</p>}
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

      {isFinished && matchBet}

      <ContentReady module="match" phase="primary" />
      {scoreboard && scoreboard.detailedPlayerIds.size > 0 && (
        <Suspense fallback={<section aria-label="详细统计" aria-busy="true" className="min-h-96"><p role="status">详细统计加载中…</p></section>}>
          <AdvancedMatchStats core={core} scoreboard={scoreboard} statsQuery={statsQuery} />
        </Suspense>
      )}
      {isFinished && mvpCandidates.length > 0 && (
        <Suspense fallback={<section aria-label="MVP 投票" aria-busy="true" className="min-h-64"><p role="status">MVP 投票加载中…</p></section>}>
          <MatchMvpPanel core={core} candidates={mvpCandidates} userId={userSession?.userId ?? null} scoreboard={scoreboard!} />
        </Suspense>
      )}

      {/* 弃赛且没有实际地图或阵容时，不展示空名单。 */}
      {isFinished && (!match.isForfeit || maps.length > 0 || Boolean(teamARoster?.length || teamBRoster?.length)) && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--color-fg)]">本场阵容</h2>
            <Panel contentClassName="p-4">
              <MatchRosterView entryAId={match.entryAId} entryBId={match.entryBId}
                teamAName={teamA?.name ?? "队伍 A"}
                teamARoster={teamARoster}
                teamBName={teamB?.name ?? "队伍 B"}
                teamBRoster={teamBRoster}
              />
            </Panel>
          </section>
        </>
      )}

      {/* 赛后解说名单；回放入口与 BP 记录同处顶部操作区。 */}
      {isFinished && commentatorRows.length > 0 && (
        <Panel label="解说" contentClassName="space-y-2 p-4">
          <p className="text-sm">解说：{publicCommentators.map((person, index) => <React.Fragment key={person.userId}>{index > 0 ? "、" : null}{person.playerUserId ? <PlayerProfileLink userId={person.playerUserId}>{getPublicDisplayName(person)}</PlayerProfileLink> : getPublicDisplayName(person)}</React.Fragment>)}</p>
        </Panel>
      )}
    </>
  );
}


type Scoreboard = NonNullable<Awaited<ReturnType<typeof loadMatchScoreboard>>>;

async function AdvancedMatchStats({ core, scoreboard, statsQuery }: {
  core: MatchCore; scoreboard: Scoreboard;
  statsQuery: Awaited<MatchDetailPageProps["searchParams"]>;
}) {
  const { seasonSlug, season, match, maps } = core;
  let detailed: Awaited<ReturnType<typeof getPublicMatchPlayerDetail>> = null;
  let detailedUnavailable = false;
  let detailedPlayerId: string | null = null;
  let detailedMap: (typeof maps)[number] | undefined = undefined;

  if (scoreboard) {
    detailedPlayerId = scoreboard.detailedPlayerIds.has(statsQuery.statsPlayer ?? "")
      ? statsQuery.statsPlayer!
      : scoreboard.detailedPlayerIds.has(match.mvpWinnerUserId ?? "") ? match.mvpWinnerUserId : [...scoreboard.detailedPlayerIds][0] ?? null;
    detailedMap = maps.find((map) => map.id === statsQuery.statsMap && scoreboard.detailedMapIds.has(map.id));
    if (detailedPlayerId) {
      const playerId = detailedPlayerId;
      const result = await readOptionalPublicStats("match_player", async () => ({
        detail: await loadPlayerDetail(match.id, playerId, detailedMap?.mapName, season.status === "draft" ? "draft" : "public"),
      }));
      detailed = result?.detail ?? null;
      detailedUnavailable = result === null;
    }
  }
  return <>
      {detailedUnavailable && <p role="status">高级统计暂时无法加载，请稍后重试。</p>}
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
          <ContentReady module="match" phase="advanced" />
        </section>
      )}
  </>;
}

async function MatchMvpPanel({ core, candidates, userId, scoreboard }: {
  core: MatchCore; candidates: React.ComponentProps<typeof MatchMvpVote>["candidates"];
  userId: string | null; scoreboard: Scoreboard;
}) {
  const { seasonSlug, season, match } = core;
  const winnerHasDetail = match.mvpWinnerUserId !== null && scoreboard.detailedPlayerIds.has(match.mvpWinnerUserId);
  const [votes, existingVote, winnerSummary] = await Promise.all([
    getMatchMvpResults(match.id),
    userId ? db.query.matchMvpVotes.findFirst({
      where: and(eq(matchMvpVotes.matchId, match.id), eq(matchMvpVotes.voterUserId, userId)),
      columns: { playerName: true },
    }) : Promise.resolve(null),
    winnerHasDetail ? readOptionalPublicStats("match_mvp", () => getPublicMatchMvpSummary(
      match.id, match.mvpWinnerUserId!, season.status === "draft" ? "draft" : "public",
    )) : Promise.resolve(null),
  ]);
  const winnerPerformance: MvpPerformance | null = winnerSummary ? {
    playerId: match.mvpWinnerUserId!, rounds: winnerSummary.rounds, kast: winnerSummary.kast,
    trade: winnerSummary.tradeKillsPerRound, utility: winnerSummary.utilityDamagePerRound,
    flashAssist: winnerSummary.flashAssistsPerRound,
  } : null;
  return <><MatchMvpVote matchId={match.id} candidates={candidates} currentVotes={votes}
    userVotedPlayerName={existingVote?.playerName ?? null} completedAt={match.completedAt?.toISOString() ?? null}
    winnerUserId={match.mvpWinnerUserId} winnerPerformance={winnerPerformance}
    winnerDetailsHref={winnerHasDetail ? `/${seasonSlug}/matches/${match.id}?statsPlayer=${match.mvpWinnerUserId}#detailed-stats` : undefined} /><ContentReady module="match" phase="form" /></>;
}

async function MatchLineupDetails({ a, b, matchId, cutoff, allowExpected }: {
  a: React.ComponentProps<typeof MatchLineupComparison>["a"];
  b: React.ComponentProps<typeof MatchLineupComparison>["b"];
  matchId: string; cutoff: Date | null; allowExpected: boolean;
}) {
  const careers = allowExpected || cutoff
    ? await readOptionalPublicStats("match-lineup-comparison", async () => getLineupCareers(
      [...new Set([...(a.players ?? []), ...(b.players ?? [])].filter(player => player.isStarter)
        .flatMap(player => player.userId ? [player.userId] : []))].sort(), matchId, cutoff?.toISOString() ?? null,
    )) : [];
  return <MatchLineupComparison a={a} b={b} careers={careers ?? []} historical={cutoff !== null} unavailable={careers === null} />;
}

async function MatchScouting({ core, analysis }: {
  core: MatchCore; analysis: Promise<Awaited<ReturnType<typeof loadMatchPreAnalysis>> | null>;
}) {
  const { seasonSlug, season, match, teamA, teamB } = core;
  const preAnalysis = await analysis;
  const mapProfileRows = preAnalysis?.mapProfileRows ?? [];
  const recentResultsA = preAnalysis?.recentResultsA ?? [];
  const recentResultsB = preAnalysis?.recentResultsB ?? [];
  const h2hMatches = preAnalysis?.h2hMatches ?? [];
  const h2hWinsA = preAnalysis?.h2hWinsA ?? 0;
  const h2hWinsB = preAnalysis?.h2hWinsB ?? 0;

  return <>
          {mapProfileRows.length > 0 && (
            <MatchMapProfile entryAId={match.entryAId} entryBId={match.entryBId} seasonSlug={seasonSlug}
              rows={mapProfileRows}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
            />
          )}

          {(recentResultsA.length > 0 || recentResultsB.length > 0) && (
            <MatchRecentResults entryAId={match.entryAId} entryBId={match.entryBId}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              teamA={recentResultsA}
              teamB={recentResultsB}
              seasonSlug={seasonSlug}
            />
          )}

          {h2hMatches.length > 0 && (
            <MatchHeadToHead stagePlan={season.stagePlan} entryAId={match.entryAId} entryBId={match.entryBId}
              teamAName={teamA?.name ?? "队伍 A"}
              teamBName={teamB?.name ?? "队伍 B"}
              teamAWins={h2hWinsA}
              teamBWins={h2hWinsB}
              matches={h2hMatches}
              seasonSlug={seasonSlug}
            />
          )}

  </>;
}
