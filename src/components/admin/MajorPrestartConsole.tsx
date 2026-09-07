import { Checklist, Marker, Panel } from "@/components/rivalhub";
import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import { presentMajorPrestartReadiness } from "@/lib/major/prestart-presentation";
import { MajorPrestartManagement, type MajorPrestartManagementData } from "./MajorPrestartManagement";
import { MajorTournamentSeedsManagement, type MajorTournamentSeedsManagementData } from "./MajorTournamentSeedsManagement";
import { MajorStartManagement } from "./MajorStartManagement";

export function MajorPrestartConsole({
  seasonName,
  readiness,
  management,
  seedManagement,
  started,
}: {
  seasonName: string;
  readiness: MajorPrestartReadiness;
  management: MajorPrestartManagementData;
  seedManagement: MajorTournamentSeedsManagementData;
  started: boolean;
}) {
  const { tasks, systemBlockers } = presentMajorPrestartReadiness(readiness);

  return (
    <div className="space-y-6">
      <div>
        <Marker sub={readiness.canStart ? "可进入开赛流程" : "准备未完成"}>
          赛事赛前 · {seasonName}
        </Marker>
        <p className="text-sm text-[var(--color-fg-mid)]">
          按正式参赛队、名单、运营事项、种子和开赛依次完成。每次确认都会重新检查当前资料。
        </p>
      </div>

      {tasks.length > 0 && <Panel label="当前待办">
        <Checklist items={tasks} />
      </Panel>}

      {systemBlockers.length > 0 && <Panel label="系统发现的待处理问题">
        <Checklist items={systemBlockers} />
      </Panel>}

      <MajorPrestartManagement data={management} />
      <MajorTournamentSeedsManagement data={seedManagement} />
      <MajorStartManagement seasonId={management.seasonId} openingPlan={readiness.openingPlan} canStart={readiness.canStart} started={started} />

      <Panel label="STAGE1 首轮预览">
        {readiness.openingPlan ? (
          <ol className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            {readiness.openingPlan.firstRound.pairings.map((pairing) => (
              <li key={`${pairing.higherSeed.teamId}-${pairing.lowerSeed.teamId}`} className="border border-[var(--color-border)] px-3 py-2">
                #{pairing.higherSeed.tournamentSeed} vs #{pairing.lowerSeed.tournamentSeed} · {pairing.format.toUpperCase()}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[var(--color-fg-mid)]">
            完成所有赛前条件后，这里会显示首轮对阵。
          </p>
        )}
      </Panel>
    </div>
  );
}
