import { notFound } from "next/navigation";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, competitionEntries, eventRosters, eventRosterMembers, matchMaps, matchRosters, matchRosterPlayers, matchCommentators, postMatchReports, seasonAdminGrants } from "@/db/schema";
import { users, seasonRegistrations } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { calculateStandings } from "@/lib/standings";
import { GenerateScheduleCard } from "@/components/matches/GenerateScheduleCard";
import { GeneratePlayoffCard } from "@/components/matches/GeneratePlayoffCard";
import { CreateMatchForm } from "@/components/matches/CreateMatchForm";
import { AdminMatchFilter } from "@/components/matches/AdminMatchFilter";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { AdminMatchRow } from "@/components/matches/AdminMatchRow";
import type { TeamMemberData, RosterData } from "@/components/matches/AdminMatchRow";
import { BatchDeadlineCard } from "@/components/matches/BatchDeadlineCard";
import { SyncBracketButton } from "@/components/matches/SyncBracketButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel } from "@/components/rivalhub";
import {
  buildStageViews,
  getTeamsReferencedByMatches,
  hasAdjacentLegacyQualifierPlayoff,
  resolveDefaultStageKey,
} from "@/lib/matches/stage-views";
import { getFirstStageOfType, normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import Link from "next/link";
import { getStartingLineupPreflightInTx } from "@/lib/match-rosters/service";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { getDisplayName } from "@/lib/identity/display-name";
import { getPostMatchCompletion, POST_MATCH_COMPLETION_LABEL } from "@/lib/postmatch/service";

const STATUS_SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  scheduled: 1,
  finished: 2,
  cancelled: 3,
};

function mapCompletedMaps(records: { mapOrder: number; mapName: string; scoreA: number | null; scoreB: number | null; pickedByEntryId: string | null; teamAStartSide: string | null }[]) {
  return records
    .filter((r) => r.scoreA !== null)
    .map((r) => ({
      mapOrder: r.mapOrder,
      mapName: r.mapName,
      scoreA: r.scoreA as number,
      scoreB: r.scoreB as number,
      pickedByEntryId: r.pickedByEntryId,
      teamAStartSide: r.teamAStartSide as "t" | "ct" | null,
    }));
}

function mapPendingMaps(records: { mapOrder: number; mapName: string; scoreA: number | null; pickedByEntryId: string | null; teamAStartSide: string | null }[]) {
  return records
    .filter((r) => r.scoreA === null)
    .map((r) => ({
      mapOrder: r.mapOrder,
      mapName: r.mapName,
      pickedByEntryId: r.pickedByEntryId,
      teamAStartSide: r.teamAStartSide as "t" | "ct" | null,
    }));
}

function mapFinishedMaps(records: { id: string; mapName: string; scoreA: number | null; scoreB: number | null }[]) {
  return records
    .filter((r) => r.scoreA !== null && r.scoreB !== null)
    .map((r) => ({ id: r.id, mapName: r.mapName, scoreA: r.scoreA as number, scoreB: r.scoreB as number }));
}

function sortMatches<T extends { status: string; scheduledAt: Date | null; completedAt: Date | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const diff = (STATUS_SORT_ORDER[a.status] ?? 9) - (STATUS_SORT_ORDER[b.status] ?? 9);
    if (diff !== 0) return diff;
    if (a.status === "scheduled" || a.status === "in_progress") {
      if (!a.scheduledAt && !b.scheduledAt) return 0;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return a.scheduledAt.getTime() - b.scheduledAt.getTime();
    }
    if (a.status === "finished") {
      if (!a.completedAt && !b.completedAt) return 0;
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      // 最近完成的排最前
      return b.completedAt.getTime() - a.completedAt.getTime();
    }
    return 0;
  });
}

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ stage?: string; status?: string; team?: string }>;
}

export default async function AdminMatchesPage({ params, searchParams }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  const { stage: filterStage, status: filterStatus, team: filterTeam } = await searchParams;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();
  await requireSeasonAdmin(season.id);

  const [allTeams, allMatches] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, season.id),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
  ]);
  const finishedIds = allMatches.filter((match) => match.status === "finished").map((match) => match.id);
  const [commentatorRows, submissionRows, seasonAdminRows] = await Promise.all([
    finishedIds.length ? db.select({ matchId: matchCommentators.matchId, userId: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, liveStreamUrl: users.liveStreamUrl }).from(matchCommentators).innerJoin(users, eq(matchCommentators.userId, users.id)).where(inArray(matchCommentators.matchId, finishedIds)) : [],
    finishedIds.length ? db.select().from(postMatchReports).where(inArray(postMatchReports.matchId, finishedIds)) : [],
    db.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, liveStreamUrl: users.liveStreamUrl }).from(seasonAdminGrants).innerJoin(users, eq(seasonAdminGrants.userId, users.id)).where(eq(seasonAdminGrants.seasonId, season.id)),
  ]);
  const commentatorsByMatch = new Map<string, { userId: string; name: string; hasLiveStream: boolean }[]>();
  for (const row of commentatorRows) { const list = commentatorsByMatch.get(row.matchId) ?? []; list.push({ userId: row.userId, name: getDisplayName(row), hasLiveStream: Boolean(row.liveStreamUrl) }); commentatorsByMatch.set(row.matchId, list); }
  const submissionByMatch = new Map(submissionRows.map((row) => [row.matchId, row]));
  const seasonAdmins = seasonAdminRows.map((row) => ({ userId: row.userId, name: getDisplayName(row), hasLiveStream: Boolean(row.liveStreamUrl) }));

  // 查进行中的比赛的地图记录（供 MapByMapInput 用）
  const inProgressMatchIds = allMatches
    .filter((m) => m.status === "in_progress")
    .map((m) => m.id);
  const allMapRecords = inProgressMatchIds.length > 0
    ? await db.query.matchMaps.findMany({
        where: inArray(matchMaps.matchId, inProgressMatchIds),
        orderBy: [asc(matchMaps.mapOrder)],
      })
    : [];
  const mapsByMatchId = new Map<string, typeof allMapRecords>();
  for (const r of allMapRecords) {
    const arr = mapsByMatchId.get(r.matchId) ?? [];
    arr.push(r);
    mapsByMatchId.set(r.matchId, arr);
  }

  const teamMap = new Map(allTeams.map((t) => [t.id, t.name]));
  const stagePlan = normalizeStagePlan(season.stagePlan);
  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
  const qualifierStage = getFirstStageOfType(stagePlan, ["round_robin", "swiss"]);
  const playoffStage = getFirstStageOfType(stagePlan, ["double_elim", "single_elim"]);
  const statusFilter = (m: { status: string }) =>
    !filterStatus || filterStatus === "all" || m.status === filterStatus;
  const teamFilter = (m: { entryAId: string; entryBId: string }) =>
    !filterTeam || filterTeam === "all" || m.entryAId === filterTeam || m.entryBId === filterTeam;
  const { views: allStageViews, unconfiguredMatches } = buildStageViews(stagePlan, allMatches);
  const stageViews = allStageViews.map((view) => ({
    ...view,
    matches: sortMatches(view.matches.filter(statusFilter).filter(teamFilter)),
  }));

  // 已完成比赛的地图列表（用于 OCR 录入面板）
  const finishedMatchIds = allMatches
    .filter((m) => m.status === "finished")
    .map((m) => m.id);
  const allMaps =
    finishedMatchIds.length > 0
      ? await db.query.matchMaps.findMany({
          where: inArray(matchMaps.matchId, finishedMatchIds),
          orderBy: (t, { asc }) => [asc(t.mapOrder)],
        })
      : [];
  const mapsByMatch = new Map<string, typeof allMaps>();
  for (const map of allMaps) {
    const arr = mapsByMatch.get(map.matchId) ?? [];
    arr.push(map);
    mapsByMatch.set(map.matchId, arr);
  }

  const matchCount = allMatches.length;
  const hasSwissStage = stagePlan.some((stage) => stage.type === "swiss");
  const canGenerate =
    season.status === "playing" && matchCount === 0 && allTeams.length >= 2 && !hasSwissStage;
  const qualifierView = qualifierStage
    ? allStageViews.find((view) => view.stage.key === qualifierStage.key)
    : null;
  const playoffView = playoffStage
    ? allStageViews.find((view) => view.stage.key === playoffStage.key)
    : null;
  const hasLegacyAdjacentPlayoff = hasAdjacentLegacyQualifierPlayoff(stagePlan);
  const hasTerminalLegacyQualifierMatches =
    qualifierView != null &&
    qualifierView.matches.length > 0 &&
    qualifierView.matches.every((match) => match.status === "finished" || match.status === "cancelled");
  const canGeneratePlayoff =
    !!qualifierStage &&
    !!playoffStage &&
    hasLegacyAdjacentPlayoff &&
    hasTerminalLegacyQualifierMatches &&
    playoffView?.matches.length === 0;

  const standingsByStage = new Map(
    allStageViews
      .filter((view) => view.stage.type === "round_robin" && view.matches.length > 0)
      .map((view) => [
        view.stage.key,
        calculateStandings(
          getTeamsReferencedByMatches(allTeams, view.matches),
          view.matches.filter((match) => match.status === "finished"),
        ),
      ]),
  );
  const qualifierStandings = qualifierStage ? standingsByStage.get(qualifierStage.key) ?? [] : [];
  const defaultStageKey = resolveDefaultStageKey(stagePlan, allMatches, filterStage);

  const batchDeadlineGroups: { label: string; stage: string; round?: number | null; entryRound?: string | null; matchCount: number }[] = [];
  if (matchCount > 0) {
    const activeMatches = allMatches.filter(
      (m) => m.status === "scheduled" || m.status === "in_progress",
    );
    const groupMap = new Map<string, typeof batchDeadlineGroups[number]>();
    for (const m of activeMatches) {
      const stageConf = stagePlan.find((s) => s.key === m.stage);
      const stageName = stageConf?.name ?? m.stage;
      let key: string;
      let label: string;
      if (m.round != null) {
        key = `${m.stage}:round:${m.round}`;
        label = `${stageName} · 第 ${m.round} 轮`;
      } else if (m.entryRound) {
        key = `${m.stage}:entry:${m.entryRound}`;
        label = `${stageName} · ${m.entryRound}`;
      } else {
        key = `${m.stage}:all`;
        label = stageName;
      }
      const existing = groupMap.get(key);
      if (existing) {
        existing.matchCount += 1;
      } else {
        groupMap.set(key, { label, stage: m.stage, round: m.round, entryRound: m.entryRound, matchCount: 1 });
      }
    }
    batchDeadlineGroups.push(...groupMap.values());
  }

  // ── 人员名单查询（供 AdminRosterDialog 用）───────────────────
  let allTeamMembers: TeamMemberData[] = [];
  const rosterByMatch = new Map<string, Map<string, RosterData>>();
  const teamMembersByTeam = new Map<string, TeamMemberData[]>();

  if (matchCount > 0) {
    const displayedMatchIds = stageViews.flatMap((view) => view.matches.map((match) => match.id));

    const [members, rosters] = await Promise.all([
      db
        .select({
          id: eventRosterMembers.id,
          entryId: eventRosters.entryId,
          steamName: users.steamName,
          displayName: users.displayName,
          perfectName: users.perfectName,
          primaryPosition: seasonRegistrations.primaryPosition,
        })
        .from(eventRosterMembers)
        .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
        .innerJoin(users, eq(eventRosterMembers.userId, users.id))
        .leftJoin(
          seasonRegistrations,
          and(
            eq(seasonRegistrations.userId, eventRosterMembers.userId),
            eq(seasonRegistrations.seasonId, season.id),
          ),
        )
        .where(inArray(eventRosters.entryId, allTeams.map((t) => t.id))),
      displayedMatchIds.length > 0
        ? (async () => {
            const rosters = await db
              .select()
              .from(matchRosters)
              .where(inArray(matchRosters.matchId, displayedMatchIds));
            if (rosters.length === 0) return [] as typeof rosters & { players: (typeof matchRosterPlayers.$inferSelect)[] }[];
            const rosterIds = rosters.map((r) => r.id);
            const players = await db
              .select()
              .from(matchRosterPlayers)
              .where(inArray(matchRosterPlayers.rosterId, rosterIds));
            const playerMap = new Map<string, (typeof matchRosterPlayers.$inferSelect)[]>();
            for (const p of players) {
              const list = playerMap.get(p.rosterId) ?? [];
              list.push(p);
              playerMap.set(p.rosterId, list);
            }
            return rosters.map((r) => ({
              ...r,
              players: playerMap.get(r.id) ?? [],
            }));
          })()
        : ([] as (typeof matchRosters.$inferSelect & {
            players: (typeof matchRosterPlayers.$inferSelect)[];
          })[]),
    ]);

    allTeamMembers = members.map((r) => ({
      id: r.id,
      entryId: r.entryId,
      steamName: r.steamName ?? "未知",
      displayName: r.displayName ?? null,
      perfectName: r.perfectName ?? null,
      primaryPosition: r.primaryPosition ?? "—",
    }));

    for (const t of allTeamMembers) {
      const arr = teamMembersByTeam.get(t.entryId) ?? [];
      arr.push(t);
      teamMembersByTeam.set(t.entryId, arr);
    }

    for (const roster of rosters) {
      const matchMap =
        rosterByMatch.get(roster.matchId) ??
        new Map<string, RosterData>();
      const starters: string[] = [];
      const substitutes: string[] = [];
      for (const p of roster.players) {
        if (p.isStarter) {
          starters.push(p.eventRosterMemberId);
        } else {
          substitutes.push(p.eventRosterMemberId);
        }
      }
      matchMap.set(roster.entryId, {
        rosterId: roster.id,
        starters,
        substitutes,
        status: roster.status,
      });
      rosterByMatch.set(roster.matchId, matchMap);
    }
  }

  const preflightByMatch = new Map<string, Map<string, { valid: boolean; blockers: string[] }>>();
  for (const match of allMatches.filter((item) => item.status === "scheduled" && item.ownership === "major_stage")) {
    const rosters = rosterByMatch.get(match.id);
    if (!rosters) continue;
    const result = new Map<string, { valid: boolean; blockers: string[] }>();
    for (const teamId of [match.entryAId, match.entryBId]) {
      const roster = rosters.get(teamId);
      if (!roster) continue;
      const preflight = await db.transaction((tx) => getStartingLineupPreflightInTx(tx, { match, entryId: teamId, starterIds: roster.starters, substituteIds: roster.substitutes }));
      result.set(teamId, { valid: preflight.valid, blockers: preflight.blockers });
    }
    preflightByMatch.set(match.id, result);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-fg)]">
          比赛管理 · {season.name}
        </h1>
        <div className="flex items-center gap-3">
          {allTeams.length >= 2 && stagePlan.length > 0 && (
            <CreateMatchForm
              seasonId={season.id}
              teams={allTeams.map((t) => ({ id: t.id, name: t.name }))}
              stages={stagePlan.map((s) => ({ key: s.key, name: s.name }))}
            />
          )}
          <Link
            href={`/${seasonSlug}/matches`}
            className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
          >
            查看公开赛程 →
          </Link>
        </div>
      </div>

      {/* 筛选 */}
      {matchCount > 0 && (
        <AdminMatchFilter
          stages={stagePlan.map((s) => ({ key: s.key, name: s.name }))}
          teams={allTeams.map((t) => ({ id: t.id, name: t.name }))}
        />
      )}

      {unconfiguredMatches.length > 0 && (
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">
            检测到 {unconfiguredMatches.length} 场比赛引用了当前 StagePlan 中不存在的阶段，请检查赛制配置。
          </p>
          <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
            涉及阶段：{[...new Set(unconfiguredMatches.map((match) => match.stage))].join("、")}
          </p>
        </Panel>
      )}

      {/* 赛季状态提示 */}
      {season.status !== "playing" && matchCount === 0 && (
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">
            赛季当前状态为「{presentSeasonStatus(season.status).label}」，需进入比赛进行中状态后才能生成赛程。
          </p>
        </Panel>
      )}

      {/* 一键生成赛程（首次） */}
      {canGenerate && (
        <GenerateScheduleCard
          seasonId={season.id}
          stagePlan={stagePlan}
          teamCount={allTeams.length}
        />
      )}

      {season.status === "playing" && matchCount === 0 && allTeams.length >= 2 && hasSwissStage && (
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">
            该赛制的自动赛程运行尚未启用。
          </p>
        </Panel>
      )}

      {/* 生成正赛（排位赛全部结束后） */}
      {canGeneratePlayoff && qualifierStandings.length > 0 && playoffStage && (
        <GeneratePlayoffCard
          seasonId={season.id}
          stageKey={playoffStage.key}
          stageName={playoffStage.name}
          standings={qualifierStandings}
        />
      )}

      {/* 修复 Bracket 缺失比赛（bracket 已初始化时显示） */}
      {playoffStage && hasLegacyAdjacentPlayoff && (
        <SyncBracketButton seasonId={season.id} />
      )}

      {/* 批量设置截止时间 */}
      {batchDeadlineGroups.length > 0 && (
        <BatchDeadlineCard seasonId={season.id} groups={batchDeadlineGroups} />
      )}
      {finishedIds.length > 0 && <details className="rounded border border-[var(--color-border)] px-4 py-3"><summary className="cursor-pointer text-sm font-medium">解说有效场次统计</summary><div className="mt-3 space-y-2 text-sm">{seasonAdmins.map((admin) => { const effective = allMatches.filter((match) => match.status === "finished" && Boolean(match.videoUrl) && Boolean(submissionByMatch.get(match.id)) && (commentatorsByMatch.get(match.id) ?? []).some((commentator) => commentator.userId === admin.userId)).map((match) => `${stagePlan.find((stage) => stage.key === match.stage)?.name ?? match.stage} · ${match.round ? `第 ${match.round} 轮 · ` : ""}${teamMap.get(match.entryAId) ?? "TBD"} vs ${teamMap.get(match.entryBId) ?? "TBD"}`); return <div key={admin.userId}><strong>{admin.name}</strong> · {effective.length} 场{effective.length > 0 && <span className="text-[var(--color-fg-mid)]">：{effective.join("；")}</span>}</div>; })}</div></details>}

      {/* Tab 面板 */}
      {matchCount > 0 && defaultStageKey && (
        <Tabs defaultValue={defaultStageKey}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {stageViews.map(({ stage }) => (
              <TabsTrigger key={stage.key} value={stage.key}>{stage.name}</TabsTrigger>
            ))}
          </TabsList>

          {stageViews.map(({ stage, matches: stageMatches }) => {
            const standings = standingsByStage.get(stage.key) ?? [];
            const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";

            return (
            <TabsContent key={stage.key} value={stage.key} className="space-y-6 mt-4">
              {standings.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[var(--color-fg)]">积分榜</h2>
                  <Panel pad={0} className="overflow-hidden">
                    <StandingsTable
                      standings={standings}
                      seasonSlug={seasonSlug}
                      isFinal={false}
                    />
                  </Panel>
                </section>
              )}

              <section className="space-y-3">
                <h2 className="text-base font-semibold text-[var(--color-fg)]">赛程</h2>
                {stageMatches.length === 0 ? (
                  <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
                    暂无比赛记录
                  </Panel>
                ) : (
                  <div className="space-y-3">
                  {stageMatches.map((m) => {
                    const unknownTeamName = isPlayoff ? "TBD" : "未知队伍";
                    const teamAName = teamMap.get(m.entryAId) ?? unknownTeamName;
                    const teamBName = teamMap.get(m.entryBId) ?? unknownTeamName;
                    return (
                      <AdminMatchRow
                        key={m.id}
                        match={m}
                        teamAName={teamAName}
                        teamBName={teamBName}
                        seasonSlug={seasonSlug}
                        mapPool={mapPool}
                        teamAMembers={teamMembersByTeam.get(m.entryAId) ?? []}
                        teamBMembers={teamMembersByTeam.get(m.entryBId) ?? []}
                        teamARoster={rosterByMatch.get(m.id)?.get(m.entryAId) ?? null}
                        teamBRoster={rosterByMatch.get(m.id)?.get(m.entryBId) ?? null}
                        teamAPreflight={preflightByMatch.get(m.id)?.get(m.entryAId) ?? null}
                        teamBPreflight={preflightByMatch.get(m.id)?.get(m.entryBId) ?? null}
                        completedMaps={mapCompletedMaps(mapsByMatchId.get(m.id) ?? [])}
                        pendingMaps={mapPendingMaps(mapsByMatchId.get(m.id) ?? [])}
                        finishedMaps={mapFinishedMaps(mapsByMatch.get(m.id) ?? [])}
                        postMatch={m.status === "finished" ? { commentators: commentatorsByMatch.get(m.id) ?? [], seasonAdmins, submittedAt: submissionByMatch.get(m.id)?.submittedAt ?? null, submittedByUserId: submissionByMatch.get(m.id)?.submittedByUserId ?? null, videoUrl: m.videoUrl, completionLabel: POST_MATCH_COMPLETION_LABEL[getPostMatchCompletion(submissionByMatch.get(m.id)?.submittedAt ?? null, m.videoUrl)] } : null}
                      />
                    );
                  })}
                  </div>
                )}
              </section>
            </TabsContent>
            );
          })}
        </Tabs>
      )}

      {!canGenerate && matchCount === 0 && (
        <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>
      )}
    </div>
  );
}
