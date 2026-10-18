import { loadAdminPostMatchTasks } from "@/lib/admin/matches/postmatch-tasks";
import { AdminPostMatchTasks } from "@/components/matches/AdminPostMatchTasks";
import { loadAdminMatchOperations } from "@/lib/admin/matches/operations";
import { AdminMatchOperations } from "@/components/matches/AdminMatchOperations";
import { loadMatchResources } from "@/lib/admin/matches/resources";
import { MatchResources } from "@/components/matches/MatchResources";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchDeadlineCard } from "@/components/matches/BatchDeadlineCard";
import { CreateMatchForm } from "@/components/matches/CreateMatchForm";
import { GenerateScheduleCard } from "@/components/matches/GenerateScheduleCard";
import { AdminMatchFilter } from "@/components/matches/AdminMatchFilter";
import { AdminMatchRow } from "@/components/matches/AdminMatchRow";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { MajorPlayoffRuntimeManagement } from "@/components/admin/MajorPlayoffRuntimeManagement";
import { MajorSwissRuntimeManagement } from "@/components/admin/MajorSwissRuntimeManagement";
import { PageHeader, Panel, Section } from "@/components/rivalhub";
import { AdminMatchStageTabs } from "@/components/matches/AdminMatchStageTabs";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadAdminMatchOverview } from "@/lib/admin/matches/overview";
import { presentMatchLabel } from "@/lib/matches/presentation";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { loadAdminMatchCommentary } from "@/lib/admin/matches/commentary";
import { MatchCommentaryQueue } from "@/components/matches/MatchCommentaryQueue";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ stage?: string; status?: string; team?: string; view?: string }>;
}

export default async function AdminMatchesPage({ params, searchParams }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  const filters = await searchParams;
  const view = filters.view === "schedule" || filters.view === "materials" ? filters.view : "";
  const scheduling = view === "schedule";
  const materials = view === "materials";
  const data = await loadAdminMatchOverview({ seasonSlug, ...filters });
  if (!data) notFound();
  const [commentary, resources, postMatchTasks] = await Promise.all([loadAdminMatchCommentary(data.season.id), loadMatchResources(data.season.id), loadAdminPostMatchTasks(data.season.id)]);

  const operations = await loadAdminMatchOperations(data.season.id, commentary);
  const matchCount = data.matches.length;
  const teamNameById = new Map(data.teams.map((team) => [team.id, team.name]));

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title={`${scheduling ? "赛程与阶段" : materials ? "赛后资料" : "比赛执行"} · ${data.season.name}`}
        description={materials ? "按资料缺口找到比赛，继续补齐计分板、Demo 与解说回放。" : scheduling ? "编排赛程、查看积分并推进赛事阶段。" : "处理认领、排期与赛后资料，进入单场继续工作。"}
        actions={(
          <>
          <MatchResources seasonId={data.season.id} data={resources} />
          {data.teams.length >= 2 && data.stagePlan.length > 0 && (
            <CreateMatchForm
              seasonId={data.season.id}
              teams={data.teams}
              stages={data.stagePlan.map((stage) => ({ key: stage.key, name: stage.name }))}
            />
          )}
          <Link
            href={`/${seasonSlug}/matches`}
            className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            查看公开赛程 →
          </Link>
          </>
        )}
      />

      <nav aria-label="比赛工作视图" className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3">
        {[["", "比赛执行"], ["schedule", "赛程与阶段"], ["materials", `赛后资料 · ${postMatchTasks.length}`]].map(([targetView, label]) => {
          const query = new URLSearchParams();
          if (targetView) query.set("view", targetView);
          for (const key of ["stage", "status", "team"] as const) if (filters[key]) query.set(key, filters[key]);
          return <Link key={label} href={`/admin/${seasonSlug}/matches?${query}`} aria-current={view === targetView ? "page" : undefined} className={`rounded-sm px-4 py-2 text-sm ${view === targetView ? "bg-[var(--color-accent)] font-semibold text-[var(--color-accent-fg)]" : "bg-[var(--color-panel)]"}`}>{label}</Link>;
        })}
      </nav>
      {matchCount > 0 && (
        <AdminMatchFilter
          stages={[
            ...(data.qualificationRun ? [{ key: "play-in", name: "PLAY-IN" }] : []),
            ...data.stagePlan.map((stage) => ({ key: stage.key, name: stage.name })),
          ]}
          teams={data.teams}
          showStatus={!materials}
        />
      )}

      {!scheduling && !materials && <>
      <MatchCommentaryQueue data={commentary} seasonSlug={seasonSlug} />

      <AdminMatchOperations rows={operations} seasonSlug={seasonSlug} stage={filters.stage} team={filters.team} stageNames={Object.fromEntries(data.stagePlan.map(s => [s.key, s.name]))} />

      </>}

      {materials && <>
      <AdminPostMatchTasks rows={postMatchTasks} seasonSlug={seasonSlug} stage={filters.stage} team={filters.team} stageNames={Object.fromEntries(data.stagePlan.map(s => [s.key, s.name]))} />
      </>}

      {unconfiguredMatchNotice(data.unconfiguredMatches)}

      {scheduling && <>
      {data.season.status !== "playing" && matchCount === 0 && (
        <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">
            赛季当前状态为「{presentSeasonStatus(data.season.status).label}」，需进入比赛进行中状态后才能生成赛程。
          </p>
        </Panel>
      )}

      {data.canGenerate && (
        <GenerateScheduleCard
          seasonId={data.season.id}
          stagePlan={data.stagePlan}
          teamCount={data.teams.length}
        />
      )}

      {data.season.status === "playing" && matchCount === 0 && data.teams.length >= 2 && data.hasSwissStage && (
        <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">该赛制的自动赛程运行尚未启用。</p>
        </Panel>
      )}

      {data.batchDeadlineGroups.length > 0 && (
        <BatchDeadlineCard seasonId={data.season.id} groups={data.batchDeadlineGroups} />
      )}

      {data.swissRuntime && <MajorSwissRuntimeManagement data={data.swissRuntime} />}
      {data.playoffRuntime && <MajorPlayoffRuntimeManagement data={data.playoffRuntime} />}

      </>}

      {materials && data.commentaryEffectiveness.length > 0 && (
        <details className="rounded border border-[var(--color-border)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">解说有效场次统计</summary>
          <div className="mt-3 space-y-3 text-sm">
            {data.commentaryEffectiveness.map(({ admin, matches }) => (
              <div key={admin.userId}>
                <strong>{admin.name}</strong> · {matches.length} 场
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--color-fg-mid)]">
                  {matches.map((match) => (
                    <li key={match.id}>
                      {presentMatchLabel({
                        stage: match.stage,
                        stageName: data.stagePlan.find((stage) => stage.key === match.stage)?.name,
                        round: match.round,
                        entryRound: match.entryRound,
                        teamAName: teamNameById.get(match.entryAId) ?? "待定",
                        teamBName: teamNameById.get(match.entryBId) ?? "待定",
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {!materials && (matchCount > 0 || data.qualificationRun) && data.defaultStageKey && (
        <AdminMatchStageTabs value={data.defaultStageKey}>
          <TabsList className="h-auto min-h-10 max-w-full justify-start overflow-x-auto overflow-y-hidden">
            {data.stageViews.map(({ stage }) => (
              <TabsTrigger key={stage.key} value={stage.key}>{stage.name}</TabsTrigger>
            ))}
          </TabsList>

          {data.stageViews.map(({ stage, matches }) => {
            const standings = data.standingsByStage.get(stage.key) ?? [];
            const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";
            return (
              <TabsContent key={stage.key} value={stage.key} className="mt-4 space-y-6">
                {scheduling && standings.length > 0 && (
                  <Section className="space-y-2">
                    <h2 className="text-base font-semibold text-[var(--color-fg)]">积分榜</h2>
                    <Panel contentClassName="p-0" className="overflow-hidden">
                      <StandingsTable standings={standings} seasonSlug={seasonSlug} isFinal={false} />
                    </Panel>
                  </Section>
                )}

                <Section>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--color-fg)]">赛程</h2>
                    <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
                      列表只展示比赛摘要；点击“进入比赛工作台”处理单场首发、BP、结果与赛后资料。
                    </p>
                  </div>
                  {matches.length === 0 ? (
                    <Panel contentClassName="p-8 text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>
                  ) : (
                    <div className="space-y-3">
                      {matches.map((match) => (
                        <AdminMatchRow
                          key={match.id}
                          match={match}
                          teamAName={teamNameById.get(match.entryAId) ?? (isPlayoff ? "待定" : "未知队伍")}
                          teamBName={teamNameById.get(match.entryBId) ?? (isPlayoff ? "待定" : "未知队伍")}
                          seasonSlug={seasonSlug}
                          stageName={stage.name}
                          returnTo={`/admin/${seasonSlug}/matches?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === "string")), stage: stage.key })}#match-${match.id}`}
                          commentary={commentary.byMatchId[match.id]}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </TabsContent>
            );
          })}
        </AdminMatchStageTabs>
      )}

      {matchCount === 0 && (
        <Panel contentClassName="p-8 text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>
      )}
    </div>
  );
}

function unconfiguredMatchNotice(matches: { stage: string }[]) {
  if (matches.length === 0) return null;
  return (
    <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
      <p className="text-sm text-[var(--color-warn)]">
        检测到 {matches.length} 场比赛引用了当前 StagePlan 中不存在的阶段，请检查赛制配置。
      </p>
      <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
        涉及阶段：{[...new Set(matches.map((match) => match.stage))].join("、")}
      </p>
    </Panel>
  );
}
