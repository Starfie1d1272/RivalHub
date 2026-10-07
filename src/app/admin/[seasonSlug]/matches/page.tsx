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
import { SwissBracket } from "@/components/matches/SwissBracket";
import { MajorPlayoffRuntimeManagement } from "@/components/admin/MajorPlayoffRuntimeManagement";
import { MajorSwissRuntimeManagement } from "@/components/admin/MajorSwissRuntimeManagement";
import { PageHeader, Panel, Section } from "@/components/rivalhub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadAdminMatchOverview } from "@/lib/admin/matches/overview";
import { presentMatchLabel } from "@/lib/matches/presentation";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { loadAdminMatchCommentary } from "@/lib/admin/matches/commentary";
import { MatchCommentaryQueue } from "@/components/matches/MatchCommentaryQueue";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ stage?: string; status?: string; team?: string }>;
}

export default async function AdminMatchesPage({ params, searchParams }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  const filters = await searchParams;
  const data = await loadAdminMatchOverview({ seasonSlug, ...filters });
  if (!data) notFound();
  const [commentary, resources] = await Promise.all([loadAdminMatchCommentary(data.season.id), loadMatchResources(data.season.id)]);

  const matchCount = data.matches.length;
  const teamNameById = new Map(data.teams.map((team) => [team.id, team.name]));

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title={`比赛总览 · ${data.season.name}`}
        description="查看当前与下一场任务，进入单场处理赛务；赛程和积分按阶段浏览。"
        actions={(
          <>
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

      <MatchCommentaryQueue data={commentary} seasonSlug={seasonSlug} />
      <MatchResources seasonId={data.season.id} data={resources} />

      {matchCount > 0 && (
        <AdminMatchFilter
          stages={[
            ...(data.qualificationRun ? [{ key: "play-in", name: "PLAY-IN" }] : []),
            ...data.stagePlan.map((stage) => ({ key: stage.key, name: stage.name })),
          ]}
          teams={data.teams}
        />
      )}

      {unconfiguredMatchNotice(data.unconfiguredMatches)}

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

      {data.commentaryEffectiveness.length > 0 && (
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

      {(matchCount > 0 || data.qualificationRun) && data.defaultStageKey && (
        <Tabs defaultValue={data.defaultStageKey}>
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
                {data.stageReadModels.get(stage.key) && (
                  <SwissBracket data={data.stageReadModels.get(stage.key)!} seasonSlug={seasonSlug} />
                )}
                {standings.length > 0 && (
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
                          commentary={commentary.byMatchId[match.id]}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {!data.canGenerate && matchCount === 0 && (
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
