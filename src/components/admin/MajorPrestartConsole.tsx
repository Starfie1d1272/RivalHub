import { Marker, Panel } from "@/components/rivalhub";
import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import { MajorPrestartManagement, type MajorPrestartManagementData } from "./MajorPrestartManagement";
import { MajorTournamentSeedsManagement, type MajorTournamentSeedsManagementData } from "./MajorTournamentSeedsManagement";
import { MajorStartManagement } from "./MajorStartManagement";
import { MajorSwissRuntimeManagement, type MajorSwissRuntimeData } from "./MajorSwissRuntimeManagement";

const STATE_LABEL = {
  ready: "已就绪",
  blocked: "需处理",
  unavailable: "尚未接入/不可确认",
} as const;

const STATE_CLASS = {
  ready: "text-emerald-700 border-emerald-300 bg-emerald-50",
  blocked: "text-amber-800 border-amber-300 bg-amber-50",
  unavailable: "text-slate-700 border-slate-300 bg-slate-50",
} as const;

export function MajorPrestartConsole({
  seasonName,
  readiness,
  management,
  seedManagement,
  started,
  swissRuntime,
}: {
  seasonName: string;
  readiness: MajorPrestartReadiness;
  management: MajorPrestartManagementData;
  seedManagement: MajorTournamentSeedsManagementData;
  started: boolean;
  swissRuntime: MajorSwissRuntimeData | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Marker sub={readiness.canStart ? "可进入开赛流程" : "准备未完成"}>
          赛事控制台 · {seasonName}
        </Marker>
        <p className="text-sm text-[var(--color-fg-mid)]">
          赛前事实与种子独立管理；只有管理员勾选明确确认后，才会原子启动赛事并创建对阵。
        </p>
      </div>

      <Panel label="赛前检查">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {readiness.checks.map((check) => (
            <section
              key={check.key}
              className="rounded-md border border-[var(--color-border)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium text-[var(--color-fg)]">{check.label}</h2>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_CLASS[check.state]}`}>
                  {STATE_LABEL[check.state]}
                </span>
              </div>
              {check.blockers.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-fg-mid)]">
                  {check.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--color-fg-mid)]">已满足该项开赛条件。</p>
              )}
            </section>
          ))}
        </div>
      </Panel>

      <MajorPrestartManagement data={management} />
      <MajorTournamentSeedsManagement data={seedManagement} />
      <MajorStartManagement seasonId={management.seasonId} openingPlan={readiness.openingPlan} started={started} />
      {swissRuntime && <MajorSwissRuntimeManagement data={swissRuntime} />}

      <Panel label="阶段一首轮预览">
        {readiness.openingPlan ? (
          <ol className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            {readiness.openingPlan.firstRound.pairings.map((pairing) => (
              <li key={`${pairing.higherSeed.teamId}-${pairing.lowerSeed.teamId}`} className="rounded border border-[var(--color-border)] px-3 py-2">
                #{pairing.higherSeed.tournamentSeed} vs #{pairing.lowerSeed.tournamentSeed} · {pairing.format.toUpperCase()}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[var(--color-fg-mid)]">
            开赛计划会在所有赛前条件通过后由领域结果提供；当前不会推导或展示临时对阵。
          </p>
        )}
      </Panel>
    </div>
  );
}
