import { notFound } from "next/navigation";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, teamMembers, matchRosters, matchRosterPlayers } from "@/db/schema";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel } from "@/components/rivalhub";
import { getFirstStageOfType, normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_SORT_ORDER: Record<string, number> = {
  in_progress: 0,
  scheduled: 1,
  finished: 2,
  cancelled: 3,
};

function mapCompletedMaps(records: { mapOrder: number; mapName: string; scoreA: number | null; scoreB: number | null; pickedByTeamId: string | null; teamAStartSide: string | null }[]) {
  return records.map((r) => ({
    mapOrder: r.mapOrder,
    mapName: r.mapName,
    scoreA: r.scoreA ?? 0,
    scoreB: r.scoreB ?? 0,
    pickedByTeamId: r.pickedByTeamId,
    teamAStartSide: r.teamAStartSide as "t" | "ct" | null,
  }));
}

function mapFinishedMaps(records: { id: string; mapName: string }[]) {
  return records.map((r) => ({ id: r.id, mapName: r.mapName }));
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
    db.query.teams.findMany({
      where: eq(teams.seasonId, season.id),
      orderBy: [asc(teams.draftOrder)],
    }),
    db.query.matches.findMany({
      where: eq(matches.seasonId, season.id),
      orderBy: [asc(matches.createdAt)],
    }),
  ]);

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
  const qualifierKey = qualifierStage?.key ?? "qualifier";
  const playoffKey = playoffStage?.key ?? "playoff";
  const statusFilter = (m: { status: string }) =>
    !filterStatus || filterStatus === "all" || m.status === filterStatus;
  const teamFilter = (m: { teamAId: string; teamBId: string }) =>
    !filterTeam || filterTeam === "all" || m.teamAId === filterTeam || m.teamBId === filterTeam;
  const qualifierMatches = sortMatches(
    allMatches.filter((m) => m.stage === qualifierKey).filter(statusFilter).filter(teamFilter)
  );
  const playoffMatches = sortMatches(
    allMatches.filter((m) => m.stage === playoffKey).filter(statusFilter).filter(teamFilter)
  );

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
  const qualifierCount = qualifierMatches.length;

  // 不受界面筛选影响，用于判断正赛是否已生成
  const allPlayoffCount = allMatches.filter((m) => m.stage === playoffKey).length;
  // 不受界面筛选影响，用于判断排位赛是否全部结束
  const allQualifierMatches = allMatches.filter((m) => m.stage === qualifierKey);

  const canGenerate = season.status === "playing" && matchCount === 0 && allTeams.length >= 2;

  // 是否所有排位赛已结束（基于全量数据，不受筛选影响）
  const allQualifierFinished =
    allQualifierMatches.length > 0 &&
    allQualifierMatches.every((m) => m.status === "finished" || m.status === "cancelled");

  // 是否可以生成正赛
  const canGeneratePlayoff =
    !!qualifierStage &&
    !!playoffStage &&
    allQualifierFinished &&
    allPlayoffCount === 0;

  // 积分榜（有排位赛时计算）
  const finishedQualifierMatches = qualifierMatches.filter((m) => m.status === "finished");
  const standings =
    qualifierStage && qualifierCount > 0
      ? calculateStandings(allTeams, finishedQualifierMatches)
      : [];

  const hasQualifier = !!qualifierStage;
  const hasPlayoff = !!playoffStage;

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
    const displayedMatchIds = qualifierMatches
      .map((m) => m.id)
      .concat(playoffMatches.map((m) => m.id));

    const [members, rosters] = await Promise.all([
      db
        .select({
          id: teamMembers.id,
          teamId: teamMembers.teamId,
          steamName: users.steamName,
          displayName: users.displayName,
          perfectName: users.perfectName,
          primaryPosition: seasonRegistrations.primaryPosition,
        })
        .from(teamMembers)
        .innerJoin(
          seasonRegistrations,
          eq(teamMembers.registrationId, seasonRegistrations.id),
        )
        .innerJoin(users, eq(seasonRegistrations.userId, users.id))
        .where(inArray(teamMembers.teamId, allTeams.map((t) => t.id))),
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
      teamId: r.teamId,
      steamName: r.steamName ?? "未知",
      displayName: r.displayName ?? null,
      perfectName: r.perfectName ?? null,
      primaryPosition: r.primaryPosition,
    }));

    for (const t of allTeamMembers) {
      const arr = teamMembersByTeam.get(t.teamId) ?? [];
      arr.push(t);
      teamMembersByTeam.set(t.teamId, arr);
    }

    for (const roster of rosters) {
      const matchMap =
        rosterByMatch.get(roster.matchId) ??
        new Map<string, RosterData>();
      const starters: string[] = [];
      const substitutes: string[] = [];
      for (const p of roster.players) {
        if (p.isStarter) {
          starters.push(p.teamMemberId);
        } else {
          substitutes.push(p.teamMemberId);
        }
      }
      matchMap.set(roster.teamId, {
        starters,
        substitutes,
        status: roster.status,
      });
      rosterByMatch.set(roster.matchId, matchMap);
    }
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

      {/* 赛季状态提示 */}
      {season.status !== "playing" && matchCount === 0 && (
        <Panel pad={16} className="border-[rgba(255,196,77,0.3)] bg-[rgba(255,196,77,0.05)]">
          <p className="text-sm text-[var(--color-warn)]">
            赛季当前状态为「{season.status}」，需进入 playing 状态后才能生成赛程。
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

      {/* 生成正赛（排位赛全部结束后） */}
      {canGeneratePlayoff && standings.length > 0 && playoffStage && (
        <GeneratePlayoffCard
          seasonId={season.id}
          stageKey={playoffStage.key}
          stageName={playoffStage.name}
          standings={standings}
        />
      )}

      {/* 批量设置截止时间 */}
      {batchDeadlineGroups.length > 0 && (
        <BatchDeadlineCard seasonId={season.id} groups={batchDeadlineGroups} />
      )}

      {/* Tab 面板 */}
      {matchCount > 0 && (
        <Tabs defaultValue={filterStage && filterStage !== "all" ? filterStage : (hasQualifier ? qualifierKey : playoffKey)}>
          <TabsList>
            {qualifierStage && <TabsTrigger value={qualifierKey}>{qualifierStage.name}</TabsTrigger>}
            {playoffStage && <TabsTrigger value={playoffKey}>{playoffStage.name}</TabsTrigger>}
          </TabsList>

          {/* 排位赛面板 */}
          {hasQualifier && (
            <TabsContent value={qualifierKey} className="space-y-6 mt-4">
              {/* 积分榜 */}
              {standings.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-base font-semibold text-[var(--color-fg)]">积分榜</h2>
                  <Panel pad={0} className="overflow-hidden">
                    <StandingsTable
                      standings={standings}
                      seasonSlug={seasonSlug}
                      isFinal={allQualifierFinished}
                    />
                  </Panel>
                </section>
              )}

              {/* 排位赛列表 */}
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-[var(--color-fg)]">赛程</h2>
                <div className="space-y-3">
                  {qualifierMatches.map((m) => {
                    const teamAName = teamMap.get(m.teamAId) ?? "未知队伍";
                    const teamBName = teamMap.get(m.teamBId) ?? "未知队伍";
                    return (
                      <AdminMatchRow
                        key={m.id}
                        match={m}
                        teamAName={teamAName}
                        teamBName={teamBName}
                        seasonSlug={seasonSlug}
                        mapPool={mapPool}
                        teamAMembers={teamMembersByTeam.get(m.teamAId) ?? []}
                        teamBMembers={teamMembersByTeam.get(m.teamBId) ?? []}
                        teamARoster={rosterByMatch.get(m.id)?.get(m.teamAId) ?? null}
                        teamBRoster={rosterByMatch.get(m.id)?.get(m.teamBId) ?? null}
                        completedMaps={mapCompletedMaps(mapsByMatchId.get(m.id) ?? [])}
                        finishedMaps={mapFinishedMaps(mapsByMatch.get(m.id) ?? [])}
                      />
                    );
                  })}
                </div>
              </section>
            </TabsContent>
          )}

          {/* 正赛面板 */}
          {hasPlayoff && (
            <TabsContent value={playoffKey} className="space-y-3 mt-4">
              <h2 className="text-base font-semibold text-[var(--color-fg)]">赛程</h2>
              {playoffMatches.length === 0 ? (
                <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">
                  {allQualifierFinished ? "点击上方「生成正赛」按钮" : "排位赛全部结束后可生成正赛"}
                </Panel>
              ) : (
                <div className="space-y-3">
                  {playoffMatches.map((m) => {
                    const teamAName = teamMap.get(m.teamAId) ?? "TBD";
                    const teamBName = teamMap.get(m.teamBId) ?? "TBD";
                    return (
                      <AdminMatchRow
                        key={m.id}
                        match={m}
                        teamAName={teamAName}
                        teamBName={teamBName}
                        seasonSlug={seasonSlug}
                        mapPool={mapPool}
                        isPlayoff
                        teamAMembers={teamMembersByTeam.get(m.teamAId) ?? []}
                        teamBMembers={teamMembersByTeam.get(m.teamBId) ?? []}
                        teamARoster={rosterByMatch.get(m.id)?.get(m.teamAId) ?? null}
                        teamBRoster={rosterByMatch.get(m.id)?.get(m.teamBId) ?? null}
                        completedMaps={mapCompletedMaps(mapsByMatchId.get(m.id) ?? [])}
                        finishedMaps={mapFinishedMaps(mapsByMatch.get(m.id) ?? [])}
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}

      {!canGenerate && matchCount === 0 && (
        <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>
      )}
    </div>
  );
}
