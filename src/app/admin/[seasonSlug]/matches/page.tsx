import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminPostMatchTasks } from "@/lib/admin/matches/postmatch-tasks";
import { loadAdminMatchOperations } from "@/lib/admin/matches/operations";
import { loadAdminMatchOverview, loadAdminMatchWorkspace } from "@/lib/admin/matches/overview";
import { loadAdminMatchCommentary } from "@/lib/admin/matches/commentary";
import { AdminPostMatchTasks } from "@/components/matches/AdminPostMatchTasks";
import { AdminMatchOperations } from "@/components/matches/AdminMatchOperations";
import { MatchResources } from "@/components/matches/MatchResources";
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
import { CommentaryEffectivenessDetails } from "@/components/matches/CommentaryEffectivenessDetails";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { MatchCommentaryQueue, MyCommentaryMatches } from "@/components/matches/MatchCommentaryQueue";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ stage?: string; status?: string; team?: string; view?: string; ops?: string }>;
}

export default async function AdminMatchesPage({ params, searchParams }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  const filters = await searchParams;
  const view = filters.view === "schedule" || filters.view === "materials" ? filters.view : "execution";
  const scheduling = view === "schedule";
  const materials = view === "materials";
  const overview = materials ? null : await loadAdminMatchOverview({ ...filters, seasonSlug, view: scheduling ? "schedule" : "execution" });
  const data = materials ? await loadAdminMatchWorkspace(seasonSlug) : overview;
  if (!data) notFound();
  const [commentary, postMatchTasks] = await Promise.all([
    view === "execution" ? loadAdminMatchCommentary(data.season.id) : Promise.resolve(null),
    materials ? loadAdminPostMatchTasks(data.season.id) : Promise.resolve([]),
  ]);
  const operations = commentary ? await loadAdminMatchOperations(data.season.id, commentary) : [];
  const matchCount = overview?.matches.length ?? 0;
  const teamNameById = new Map(data.teams.map((team) => [team.id, team.name]));
  const stages = [
    ...(data.qualificationRun ? [{ key: "play-in", name: "PLAY-IN" }] : []),
    ...data.stagePlan.map((stage) => ({ key: stage.key, name: stage.name })),
  ];
  const stageNames = Object.fromEntries(stages.map((stage) => [stage.key, stage.name]));

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title={`${scheduling ? "赛程与阶段" : materials ? "赛后资料" : "比赛执行"} · ${data.season.name}`}
        description={materials ? "按资料缺口找到比赛，补齐计分板、Demo 与解说回放。" : scheduling ? "编排赛程、查看积分并推进赛事阶段。" : "处理认领与排期，进入单场继续工作。"}
        actions={<>
          <MatchResources key={data.season.id} seasonId={data.season.id} />
          {!materials && data.teams.length >= 2 && data.stagePlan.length > 0 && <CreateMatchForm
            seasonId={data.season.id} teams={data.teams}
            stages={data.stagePlan.map((stage) => ({ key: stage.key, name: stage.name }))}
          />}
          <Link href={`/${seasonSlug}/matches`} className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">查看公开赛程 →</Link>
        </>}
      />

      <nav aria-label="比赛工作视图" className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3">
        {[["execution", "比赛执行"], ["schedule", "赛程与阶段"], ["materials", "赛后资料"]].map(([targetView, label]) => {
          const query = new URLSearchParams();
          if (targetView !== "execution") query.set("view", targetView);
          for (const key of ["stage", "team"] as const) if (filters[key]) query.set(key, filters[key]);
          if (targetView !== "materials" && filters.status) query.set("status", filters.status);
          if (targetView === "execution" && filters.ops) query.set("ops", filters.ops);
          return <Link key={label} href={`/admin/${seasonSlug}/matches?${query}`} aria-current={view === targetView ? "page" : undefined} className={`rounded-sm px-4 py-2 text-sm ${view === targetView ? "bg-[var(--color-accent)] font-semibold text-[var(--color-accent-fg)]" : "bg-[var(--color-panel)]"}`}>{label}</Link>;
        })}
      </nav>

      {commentary && <>
        <MyCommentaryMatches data={commentary} seasonSlug={seasonSlug} />
        <section aria-labelledby="execution-scope" className="space-y-4">
          <h2 id="execution-scope" className="text-base font-semibold">赛务与解说</h2>
          <AdminMatchFilter stages={stages} teams={data.teams} showStatus={false} />
          <AdminMatchOperations rows={operations} seasonSlug={seasonSlug} stage={filters.stage} team={filters.team} stageNames={stageNames} hasBet={data.season.competitionTemplate === "major"} />
          <MatchCommentaryQueue data={commentary} seasonSlug={seasonSlug} stage={filters.stage} team={filters.team} />
        </section>
      </>}

      {materials && <section aria-labelledby="materials-scope" className="space-y-4">
        <h2 id="materials-scope" className="text-base font-semibold">资料缺口</h2>
        <AdminMatchFilter stages={stages} teams={data.teams} showStatus={false} />
        <AdminPostMatchTasks rows={postMatchTasks} seasonSlug={seasonSlug} stage={filters.stage} team={filters.team} stageNames={stageNames} />
      </section>}

      {!materials && unconfiguredMatchNotice(overview?.unconfiguredMatches ?? [])}

      {scheduling && overview && <>
        {data.season.status !== "playing" && matchCount === 0 && <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">赛事当前状态为「{presentSeasonStatus(data.season.status).label}」，进入比赛进行中状态后可编排赛程。</p>
        </Panel>}
        {overview.canGenerate && <GenerateScheduleCard seasonId={data.season.id} stagePlan={data.stagePlan} teamCount={data.teams.length} />}
        {data.season.status === "playing" && matchCount === 0 && data.teams.length >= 2 && overview.hasSwissStage && <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">该赛制的自动赛程运行尚未启用。</p>
        </Panel>}
        {overview.batchDeadlineGroups.length > 0 && <BatchDeadlineCard seasonId={data.season.id} groups={overview.batchDeadlineGroups} />}
        {overview.swissRuntime && <MajorSwissRuntimeManagement data={overview.swissRuntime} />}
        {overview.playoffRuntime && <MajorPlayoffRuntimeManagement data={overview.playoffRuntime} />}
      </>}

      {materials && <CommentaryEffectivenessDetails key={data.season.id} seasonId={data.season.id} teamNames={Object.fromEntries(teamNameById)} stageNames={stageNames} />}

      {overview && (matchCount > 0 || data.qualificationRun) && overview.defaultStageKey && <section aria-labelledby="match-list-scope" className="space-y-4">
        <h2 id="match-list-scope" className="text-base font-semibold">{scheduling ? "阶段赛程" : "比赛列表"}</h2>
        <AdminMatchStageTabs value={overview.defaultStageKey}>
          <TabsList className="h-auto min-h-10 max-w-full justify-start overflow-x-auto overflow-y-hidden">
            {overview.stageViews.map(({ stage }) => <TabsTrigger key={stage.key} value={stage.key}>{stage.name}</TabsTrigger>)}
          </TabsList>
          <div className="mt-4"><AdminMatchFilter stages={stages} teams={data.teams} showStage={false} /></div>
          {overview.stageViews.filter(({ stage }) => stage.key === overview.defaultStageKey).map(({ stage, matches }) => {
            const standings = overview.standingsByStage.get(stage.key) ?? [];
            const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";
            return <TabsContent key={stage.key} value={stage.key} className="mt-4 space-y-6">
              {scheduling && standings.length > 0 && <Section className="space-y-2">
                <h3 className="text-base font-semibold">积分榜</h3>
                <Panel contentClassName="p-0" className="overflow-hidden"><StandingsTable standings={standings} seasonSlug={seasonSlug} isFinal={false} /></Panel>
              </Section>}
              {matches.length === 0 ? <Panel contentClassName="p-8 text-center text-[var(--color-fg-mid)]">当前阶段与筛选范围内没有比赛</Panel> : <div className="space-y-3">
                {matches.map((match) => <AdminMatchRow key={match.id} match={match}
                  teamAName={teamNameById.get(match.entryAId) ?? (isPlayoff ? "待定" : "未知队伍")}
                  teamBName={teamNameById.get(match.entryBId) ?? (isPlayoff ? "待定" : "未知队伍")}
                  seasonSlug={seasonSlug} stageName={stage.name}
                  returnTo={`/admin/${seasonSlug}/matches?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === "string")), stage: stage.key })}#match-${match.id}`}
                  commentary={commentary?.byMatchId[match.id]}
                />)}
              </div>}
            </TabsContent>;
          })}
        </AdminMatchStageTabs>
      </section>}
      {!materials && matchCount === 0 && <Panel contentClassName="p-8 text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>}
    </div>
  );
}

function unconfiguredMatchNotice(matches: { stage: string }[]) {
  if (matches.length === 0) return null;
  return <Panel contentClassName="p-4" className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
    <p className="text-sm text-[var(--color-warn)]">有 {matches.length} 场比赛的阶段不在当前赛事配置中，请检查赛事设置。</p>
  </Panel>;
}
