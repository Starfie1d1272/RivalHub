import { notFound } from "next/navigation";
import { eq, count, asc, and, inArray } from "drizzle-orm";
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
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { ScoreInput } from "@/components/matches/ScoreInput";
import { MapByMapInput } from "@/components/matches/MapByMapInput";
import { ScheduledAtInput } from "@/components/matches/ScheduledAtInput";
import { VetoInputDialog } from "@/components/matches/VetoInputDialog";
import { AdminRosterDialog } from "@/components/matches/AdminRosterDialog";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { DeleteMatchButton } from "@/components/matches/DeleteMatchButton";
import { BatchDeadlineCard } from "@/components/matches/BatchDeadlineCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel, StatusPill } from "@/components/rivalhub";
import { Separator } from "@/components/ui/separator";
import { getFirstStageOfType, normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import { MATCH_FORMAT_LABELS } from "@/types/match";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ stage?: string; status?: string }>;
}

export default async function AdminMatchesPage({ params, searchParams }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  const { stage: filterStage, status: filterStatus } = await searchParams;

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
  const qualifierMatches = allMatches.filter((m) => m.stage === qualifierKey).filter(statusFilter);
  const playoffMatches = allMatches.filter((m) => m.stage === playoffKey).filter(statusFilter);

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
  const playoffCount = playoffMatches.length;

  const canGenerate = season.status === "playing" && matchCount === 0 && allTeams.length >= 2;

  // 是否所有排位赛已结束
  const allQualifierFinished =
    qualifierCount > 0 &&
    qualifierMatches.every((m) => m.status === "finished" || m.status === "cancelled");

  // 是否可以生成正赛
  const canGeneratePlayoff =
    !!qualifierStage &&
    !!playoffStage &&
    allQualifierFinished &&
    playoffCount === 0;

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
  interface TeamMemberData {
    id: string;
    teamId: string;
    steamName: string;
    displayName: string | null;
    perfectName: string | null;
    primaryPosition: string;
  }
  interface RosterData {
    starters: string[];
    substitutes: string[];
    status: string | null;
  }
  let allTeamMembers: TeamMemberData[] = [];
  const rosterByMatch = new Map<string, Map<string, RosterData>>();

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
        ? db.query.matchRosters.findMany({
            where: inArray(matchRosters.matchId, displayedMatchIds),
            with: { players: true },
          })
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
        <AdminMatchFilter stages={stagePlan.map((s) => ({ key: s.key, name: s.name }))} />
      )}

      {/* 赛季状态提示 */}
      {season.status !== "playing" && matchCount === 0 && (
        <Panel pad={16} className="border-yellow-500/30 bg-yellow-500/5">
          <p className="text-sm text-yellow-600">
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
                      <Panel key={m.id} pad={16} className="space-y-3">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">{teamAName}</span>
                            <span className="text-[var(--color-fg-mid)]">
                              {m.status === "finished"
                                ? `${m.scoreA ?? 0} : ${m.scoreB ?? 0}`
                                : "vs"}
                            </span>
                            <span className="font-semibold">{teamBName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={MATCH_FORMAT_LABELS[m.format as keyof typeof MATCH_FORMAT_LABELS]} />
                            <MatchStatusBadge
                              status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                            />
                          </div>
                        </div>
                        {m.status !== "finished" && m.status !== "cancelled" && (
                          <>
                            <Separator />
                            <AdminRosterDialog
                              matchId={m.id}
                              teamAName={teamAName}
                              teamBName={teamBName}
                              teamAId={m.teamAId}
                              teamBId={m.teamBId}
                              teamAMembers={allTeamMembers.filter((t) => t.teamId === m.teamAId)}
                              teamBMembers={allTeamMembers.filter((t) => t.teamId === m.teamBId)}
                              teamARoster={rosterByMatch.get(m.id)?.get(m.teamAId) ?? null}
                              teamBRoster={rosterByMatch.get(m.id)?.get(m.teamBId) ?? null}
                            />
                            <ScheduledAtInput
                              matchId={m.id}
                              currentScheduledAt={m.scheduledAt}
                              currentCompletionDeadline={m.completionDeadline}
                            />
                            {m.status === "scheduled" && (
                              <VetoInputDialog
                                matchId={m.id}
                                format={m.format as "bo1" | "bo3" | "bo5"}
                                teamAName={teamAName}
                                teamBName={teamBName}
                                teamAId={m.teamAId}
                                teamBId={m.teamBId}
                                mapPool={mapPool}
                              />
                            )}
                            <ScoreInput
                              matchId={m.id}
                              teamAName={teamAName}
                              teamBName={teamBName}
                              currentStatus={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                              format={m.format as "bo1" | "bo3" | "bo5"}
                            />
                            {m.status === "scheduled" && (
                              <DeleteMatchButton matchId={m.id} />
                            )}
                          </>
                        )}
                        {m.status === "finished" && (mapsByMatch.get(m.id) ?? []).map((map) => (
                          <div key={map.id}>
                            <Separator />
                            <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
                          </div>
                        ))}
                      </Panel>
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
                      <Panel key={m.id} pad={16} className="space-y-3">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold">{teamAName}</span>
                            <span className="text-[var(--color-fg-mid)]">
                              {m.status === "finished"
                                ? `${m.scoreA ?? 0} : ${m.scoreB ?? 0}`
                                : "vs"}
                            </span>
                            <span className="font-semibold">{teamBName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill status={MATCH_FORMAT_LABELS[m.format as keyof typeof MATCH_FORMAT_LABELS]} />
                            <MatchStatusBadge
                              status={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                            />
                          </div>
                        </div>
                        {m.status !== "finished" && m.status !== "cancelled" && (
                          <>
                            <Separator />
                            <AdminRosterDialog
                              matchId={m.id}
                              teamAName={teamAName}
                              teamBName={teamBName}
                              teamAId={m.teamAId}
                              teamBId={m.teamBId}
                              teamAMembers={allTeamMembers.filter((t) => t.teamId === m.teamAId)}
                              teamBMembers={allTeamMembers.filter((t) => t.teamId === m.teamBId)}
                              teamARoster={rosterByMatch.get(m.id)?.get(m.teamAId) ?? null}
                              teamBRoster={rosterByMatch.get(m.id)?.get(m.teamBId) ?? null}
                            />
                            <ScheduledAtInput
                              matchId={m.id}
                              currentScheduledAt={m.scheduledAt}
                              currentCompletionDeadline={m.completionDeadline}
                            />
                            {m.status === "in_progress" ? (
                              <MapByMapInput
                                matchId={m.id}
                                format={m.format as "bo1" | "bo3" | "bo5"}
                                teamAName={teamAName}
                                teamBName={teamBName}
                                teamAId={m.teamAId}
                                teamBId={m.teamBId}
                                completedMaps={(mapsByMatchId.get(m.id) ?? []).map((r) => ({
                                  mapOrder: r.mapOrder,
                                  mapName: r.mapName,
                                  scoreA: r.scoreA ?? 0,
                                  scoreB: r.scoreB ?? 0,
                                  pickedByTeamId: r.pickedByTeamId,
                                  teamAStartSide: r.teamAStartSide as "t" | "ct" | null,
                                }))}
                                mapPool={mapPool}
                              />
                            ) : (
                              <>
                                {m.status === "scheduled" && (
                                  <VetoInputDialog
                                    matchId={m.id}
                                    format={m.format as "bo1" | "bo3" | "bo5"}
                                    teamAName={teamAName}
                                    teamBName={teamBName}
                                    teamAId={m.teamAId}
                                    teamBId={m.teamBId}
                                    mapPool={mapPool}
                                  />
                                )}
                                <ScoreInput
                                  matchId={m.id}
                                  teamAName={teamAName}
                                  teamBName={teamBName}
                                  currentStatus={m.status as "scheduled" | "in_progress" | "finished" | "cancelled"}
                                  format={m.format as "bo1" | "bo3" | "bo5"}
                                />
                                {m.status === "scheduled" && (
                                  <DeleteMatchButton matchId={m.id} />
                                )}
                              </>
                            )}
                          </>
                        )}
                        {m.status === "finished" && (mapsByMatch.get(m.id) ?? []).map((map) => (
                          <div key={map.id}>
                            <Separator />
                            <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
                          </div>
                        ))}
                      </Panel>
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
