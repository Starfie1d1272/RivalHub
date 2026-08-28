import { Checklist, Marker, Panel } from "@/components/rivalhub";
import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import { MajorPrestartManagement, type MajorPrestartManagementData } from "./MajorPrestartManagement";
import { MajorTournamentSeedsManagement, type MajorTournamentSeedsManagementData } from "./MajorTournamentSeedsManagement";
import { MajorStartManagement } from "./MajorStartManagement";
import { MajorSwissRuntimeManagement, type MajorSwissRuntimeData } from "./MajorSwissRuntimeManagement";
import { MajorPlayoffRuntimeManagement, type MajorPlayoffRuntimeData } from "./MajorPlayoffRuntimeManagement";

const STATE_LABEL = {
  ready: "已就绪",
  blocked: "需处理",
  unavailable: "尚未接入/不可确认",
} as const;


export function MajorPrestartConsole({
  seasonName,
  readiness,
  management,
  seedManagement,
  started,
  swissRuntime,
  playoffRuntime,
}: {
  seasonName: string;
  readiness: MajorPrestartReadiness;
  management: MajorPrestartManagementData;
  seedManagement: MajorTournamentSeedsManagementData;
  started: boolean;
  swissRuntime: MajorSwissRuntimeData | null;
  playoffRuntime: MajorPlayoffRuntimeData | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Marker sub={readiness.canStart ? "可进入开赛流程" : "准备未完成"}>
          赛事控制台 · {seasonName}
        </Marker>
        <p className="text-sm text-[var(--color-fg-mid)]">
          按赛前检查、正式名单、种子和阶段推进依次完成。每次确认都会重新检查当前资料。
        </p>
      </div>

      <Panel label="赛前检查">
        <Checklist items={readiness.checks.map((check) => ({ label: check.label, state: check.state === "ready" ? "complete" as const : check.state === "blocked" ? "blocked" as const : "pending" as const, detail: check.blockers.length ? check.blockers.join(" ") : STATE_LABEL[check.state] }))} />
      </Panel>

      <MajorPrestartManagement data={management} />
      <MajorTournamentSeedsManagement data={seedManagement} />
      <MajorStartManagement seasonId={management.seasonId} openingPlan={readiness.openingPlan} canStart={readiness.canStart} started={started} />
      {swissRuntime && <MajorSwissRuntimeManagement data={swissRuntime} />}
      {playoffRuntime && <MajorPlayoffRuntimeManagement data={playoffRuntime} />}

      <Panel label="阶段一首轮预览">
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
