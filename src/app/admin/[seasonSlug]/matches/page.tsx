import Link from "next/link";
import { notFound } from "next/navigation";
import { BatchDeadlineCard } from "@/components/matches/BatchDeadlineCard";
import { CreateMatchForm } from "@/components/matches/CreateMatchForm";
import { GeneratePlayoffCard } from "@/components/matches/GeneratePlayoffCard";
import { GenerateScheduleCard } from "@/components/matches/GenerateScheduleCard";
import { AdminMatchFilter } from "@/components/matches/AdminMatchFilter";
import { AdminMatchRow } from "@/components/matches/AdminMatchRow";
import { StandingsTable } from "@/components/matches/StandingsTable";
import { SyncBracketButton } from "@/components/matches/SyncBracketButton";
import { MajorPlayoffRuntimeManagement } from "@/components/admin/MajorPlayoffRuntimeManagement";
import { MajorSwissRuntimeManagement } from "@/components/admin/MajorSwissRuntimeManagement";
import { Panel } from "@/components/rivalhub";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadAdminMatchOverview } from "@/lib/admin/matches/overview";
import { presentMatchLabel } from "@/lib/matches/presentation";
import { presentSeasonStatus } from "@/lib/seasons/presentation";

interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ stage?: string; status?: string; team?: string }>;
}

export default async function AdminMatchesPage({ params, searchParams }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  const filters = await searchParams;
  const data = await loadAdminMatchOverview({ seasonSlug, ...filters });
  if (!data) notFound();

  const matchCount = data.matches.length;
  const teamNameById = new Map(data.teams.map((team) => [team.id, team.name]));

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-fg)]">比赛总览 · {data.season.name}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
            按阶段查看赛程、积分与 Major runtime；进入单场工作台处理本场运营细节。
          </p>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </header>

      {matchCount > 0 && (
        <AdminMatchFilter
          stages={data.stagePlan.map((stage) => ({ key: stage.key, name: stage.name }))}
          teams={data.teams}
        />
      )}

      {unconfiguredMatchNotice(data.unconfiguredMatches)}

      {data.season.status !== "playing" && matchCount === 0 && (
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
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
        <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
          <p className="text-sm text-[var(--color-warn)]">该赛制的自动赛程运行尚未启用。</p>
        </Panel>
      )}

      {data.canGeneratePlayoff && data.qualifierStandings.length > 0 && data.playoffStage && (
        <GeneratePlayoffCard
          seasonId={data.season.id}
          stageKey={data.playoffStage.key}
          stageName={data.playoffStage.name}
          standings={data.qualifierStandings}
        />
      )}

      {data.playoffStage && data.hasLegacyAdjacentPlayoff && <SyncBracketButton seasonId={data.season.id} />}

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
                        teamAName: teamNameById.get(match.entryAId) ?? "TBD",
                        teamBName: teamNameById.get(match.entryBId) ?? "TBD",
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {matchCount > 0 && data.defaultStageKey && (
        <Tabs defaultValue={data.defaultStageKey}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            {data.stageViews.map(({ stage }) => (
              <TabsTrigger key={stage.key} value={stage.key}>{stage.name}</TabsTrigger>
            ))}
          </TabsList>

          {data.stageViews.map(({ stage, matches }) => {
            const standings = data.standingsByStage.get(stage.key) ?? [];
            const isPlayoff = stage.type === "double_elim" || stage.type === "single_elim";
            return (
              <TabsContent key={stage.key} value={stage.key} className="mt-4 space-y-6">
                {standings.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-base font-semibold text-[var(--color-fg)]">积分榜</h2>
                    <Panel pad={0} className="overflow-hidden">
                      <StandingsTable standings={standings} seasonSlug={seasonSlug} isFinal={false} />
                    </Panel>
                  </section>
                )}

                <section className="space-y-3">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--color-fg)]">赛程</h2>
                    <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
                      列表只展示比赛摘要；点击“进入比赛工作台”处理单场首发、BP、结果与赛后资料。
                    </p>
                  </div>
                  {matches.length === 0 ? (
                    <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>
                  ) : (
                    <div className="space-y-3">
                      {matches.map((match) => (
                        <AdminMatchRow
                          key={match.id}
                          match={match}
                          teamAName={teamNameById.get(match.entryAId) ?? (isPlayoff ? "TBD" : "未知队伍")}
                          teamBName={teamNameById.get(match.entryBId) ?? (isPlayoff ? "TBD" : "未知队伍")}
                          seasonSlug={seasonSlug}
                          stageName={stage.name}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {!data.canGenerate && matchCount === 0 && (
        <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">暂无比赛记录</Panel>
      )}
    </div>
  );
}

function unconfiguredMatchNotice(matches: { stage: string }[]) {
  if (matches.length === 0) return null;
  return (
    <Panel pad={16} className="border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)]">
      <p className="text-sm text-[var(--color-warn)]">
        检测到 {matches.length} 场比赛引用了当前 StagePlan 中不存在的阶段，请检查赛制配置。
      </p>
      <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
        涉及阶段：{[...new Set(matches.map((match) => match.stage))].join("、")}
      </p>
    </Panel>
  );
}
