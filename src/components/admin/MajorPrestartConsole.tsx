import Link from "next/link";
import { Marker, Panel } from "@/components/rivalhub";
import type { MajorPrestartReadiness } from "@/lib/major/prestart";
import { presentMajorPrestartReadiness } from "@/lib/major/prestart-presentation";
import { deriveMajorPrestartPhase, MAJOR_PRESTART_PHASES } from "@/lib/admin/season-workspace/prestart-phase";
import { MajorLiveRanking, MajorPrestartManagement, type MajorPrestartManagementData } from "./MajorPrestartManagement";
import { MajorCompetitionFlow } from "./MajorCompetitionFlow";
import { MajorTournamentSeedsManagement, type MajorTournamentSeedsManagementData } from "./MajorTournamentSeedsManagement";
import { MajorStartManagement } from "./MajorStartManagement";
import { MajorPrestartScheduleEditor } from "./MajorPrestartScheduleEditor";

export function MajorPrestartConsole({ seasonName, readiness, management, seedManagement, started }: {
  seasonName: string;
  readiness: MajorPrestartReadiness;
  management: MajorPrestartManagementData;
  seedManagement: MajorTournamentSeedsManagementData;
  started: boolean;
}) {
  const run = management.qualification.run;
  const phase = started ? 6 : deriveMajorPrestartPhase({
    registrationClosed: management.registrationClosed,
    approvedCandidateCount: management.approvedCandidateCount,
    pendingReviewCount: management.pendingReviewCount,
    entrantCapacity: management.entrantCapacity,
    entrantCount: management.entrants.length,
    qualificationConfigured: Boolean(run),
    qualificationCompleted: Boolean(run?.completedAt),
    entrantsLocked: management.entrantsLocked,
    seedsConfirmed: seedManagement.seedsConfirmed,
  });
  const noPlayIn = !run && management.registrationClosed && (management.entrants.length > 0 || management.approvedCandidateCount === management.entrantCapacity);
  const { tasks, systemBlockers } = presentMajorPrestartReadiness(readiness);
  const plannedStartOverdue = management.mainEventStartOverdue;
  const rankKey = `${run?.id ?? "new"}:${run?.entrants.map((entrant) => `${entrant.entryId}:${entrant.preliminarySeed}`).join(",") ?? management.initialPreliminaryOrderEntryIds.join(",")}`;
  const summaries = [
    `报名截止：${management.registrationClosesAt ? new Date(management.registrationClosesAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待设置"} · 已批准 ${management.approvedCandidateCount} 支`,
    noPlayIn ? "候选队伍恰好达到正赛容量，无需资格赛" : run ? `${run.format === "direct_bo3" ? "Direct BO3" : "Short Swiss"} · 直通 ${run.directEntryCount} / Play-in ${run.playInEntryCount}` : "待确定资格赛制、预排名和直通切线",
    noPlayIn ? "无需资格赛" : run ? `${run.finishedMatchCount}/${run.matchCount} 场已完成` : "等待资格方案确认",
    `${management.entrants.length}/${management.entrantCapacity} 支正赛队 · ${management.entrantsLocked ? "名单已冻结" : "名单待冻结"}`,
    seedManagement.seedsConfirmed ? "最终种子已确认" : `${seedManagement.seeds.length}/${seedManagement.entrantCapacity} 个种子已保存`,
    started ? "Major 已正式开始" : readiness.canStart ? "开赛检查已通过" : "等待赛前检查",
  ];
  const history = [
    <p key="registration">{summaries[0]} · 报名截止后候选集合用于资格方案。</p>,
    run ? <ol key="qualification-plan" className="grid gap-1 sm:grid-cols-2">{run.entrants.slice().sort((a, b) => a.preliminarySeed - b.preliminarySeed).map((entrant) => <li key={entrant.entryId}>#{entrant.preliminarySeed} {entrant.teamName} · {entrant.route === "direct" ? "直通正赛" : "Play-in"}</li>)}</ol> : <p key="qualification-plan">{summaries[1]}</p>,
    <p key="qualification">{summaries[2]} · <Link className="text-[var(--color-accent)] underline" href={`/admin/${management.seasonSlug}/matches?stage=play-in`}>查看比赛管理</Link></p>,
    <ol key="roster" className="grid gap-1 sm:grid-cols-2">{management.entrants.map((entrant) => <li key={entrant.id}>{entrant.teamName} · {entrant.roster.length} 人 · {entrant.rosterStatus === "frozen" ? "已冻结" : "待确认"}</li>)}</ol>,
    <ol key="seeds" className="grid gap-1 sm:grid-cols-2">{seedManagement.seeds.slice().sort((a, b) => a.tournamentSeed - b.tournamentSeed).map((seed) => <li key={seed.teamId}>#{seed.tournamentSeed} {seedManagement.entrants.find((entrant) => entrant.teamId === seed.teamId)?.teamName ?? seed.teamId}</li>)}</ol>,
    <p key="start">{summaries[5]}</p>,
  ];
  return <div className="space-y-5">
    <div>
      <Marker sub={started ? "Stage 1 已创建" : `当前：${MAJOR_PRESTART_PHASES[phase - 1]}`}>
        赛事赛前 · {seasonName}
      </Marker>
      <p className="mt-1 text-sm text-[var(--color-fg-mid)]">按阶段确认候选、资格赛、最终名单和种子；实际开赛只在最后一步由管理员确认。</p>
    </div>
    <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Major 赛前阶段">
      {MAJOR_PRESTART_PHASES.map((label, index) => {
        const number = index + 1;
        const complete = number < phase || started;
        const current = number === phase && !started;
        return <li key={label} aria-current={current ? "step" : undefined} className={`border px-3 py-2 text-sm ${current ? "border-[var(--color-accent)] bg-[var(--color-panel-low)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-fg-mid)]"}`}>
          <span className="mr-1 font-mono">{complete ? "✓" : current ? "●" : "○"}</span>{label}
        </li>;
      })}
    </ol>
    {MAJOR_PRESTART_PHASES.map((label, index) => {
      const number = index + 1;
      if (number >= phase) return null;
      return <details key={label} className="border border-[var(--color-border)] text-sm">
        <summary className="cursor-pointer px-3 py-2 font-medium">✓ {label} · {summaries[index]}</summary>
        <div className="border-t border-[var(--color-border)] px-3 py-2 text-[var(--color-fg-mid)]">{history[index]}</div>
      </details>;
    })}
    <Panel label={`${phase}. ${MAJOR_PRESTART_PHASES[phase - 1]}`}>
      <p className="text-sm text-[var(--color-fg-mid)]">{summaries[phase - 1]}</p>
      {phase >= 4 && !readiness.canStart && (tasks[0] || systemBlockers[0]) && <p className="mt-2 text-sm text-[var(--color-warn)]">当前阻塞：{(tasks[0] ?? systemBlockers[0])?.detail}</p>}
    </Panel>
    <Panel label="赛前时间计划">
      <div className="grid gap-4 xl:grid-cols-3">
        <MajorPrestartScheduleEditor key={`registration-${management.registrationClosesAt}`} seasonId={management.seasonId} kind="registration-close" label="报名截止时间" value={management.registrationClosesAt} disabled={Boolean(run) || management.entrantsLocked || started} hint="截止后停止新的正常报名，并以已批准名单形成资格候选。" />
        <MajorPrestartScheduleEditor key={`roster-${management.rosterChangeClosesAt}`} seasonId={management.seasonId} kind="final-roster-close" label="最终名单调整截止" value={management.rosterChangeClosesAt} disabled={management.entrantsLocked || started} hint="资格赛完成后正式参赛队重新开放名单调整；该时间是最终自助调整截止。" />
        <MajorPrestartScheduleEditor key={`main-${management.mainEventPlannedStartAt}`} seasonId={management.seasonId} kind="main-event-start" label="Main Event 计划开始" value={management.mainEventPlannedStartAt} disabled={started} hint="仅用于运营计划；到时不会自动开赛。" />
      </div>
      {plannedStartOverdue && <p className="mt-3 text-sm text-[var(--color-warn)]">Main Event 计划时间已过；{readiness.canStart ? "等待管理员确认开赛。" : "仍需处理赛前阻塞事项。"}</p>}
    </Panel>
    {phase === 1 && <>
      <Panel label="报名收口">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p>报名状态 <strong>{management.registrationOpenState === "open" ? "开放中" : management.registrationOpenState === "closed" ? "已截止" : "待开放"}</strong></p>
          <p>已批准 <strong>{management.approvedCandidateCount}</strong> 支</p>
          <p>待审核 / 补正 / 候补 <strong>{management.pendingReviewCount}</strong> 支</p>
          <p>预计正赛容量 <strong>{management.entrantCapacity}</strong> 支</p>
        </div>
      </Panel>
      <MajorLiveRanking data={management} />
    </>}
    {phase === 2 && <MajorCompetitionFlow key={rankKey} data={management} phase="plan" />}
    {phase === 3 && <MajorCompetitionFlow key={rankKey} data={management} phase="runtime" />}
    {phase === 4 && <>
      <MajorCompetitionFlow key={rankKey} data={management} phase="entrants" />
      <MajorPrestartManagement data={management} />
    </>}
    {phase === 5 && <MajorTournamentSeedsManagement data={seedManagement} management={management} />}
    {phase === 6 && <>
      <Panel label="开赛总览">
        <p className="text-sm text-[var(--color-fg-mid)]">正式参赛队 {management.entrants.length} 支 · 最终名单 {management.entrantsLocked ? "已冻结" : "待冻结"} · 种子 {seedManagement.seedsConfirmed ? "已确认" : "待确认"} · 首轮 {readiness.openingPlan?.firstRound.pairings.length ?? "待生成"} 场</p>
      </Panel>
      <MajorStartManagement seasonId={management.seasonId} openingPlan={readiness.openingPlan} canStart={readiness.canStart} started={started} />
    </>}
    {MAJOR_PRESTART_PHASES.map((label, index) => index + 1 > phase ? <p key={label} className="border-l-2 border-[var(--color-border)] pl-3 text-xs text-[var(--color-fg-mid)]">{index + 1}. {label} · 完成上一阶段后开放</p> : null)}
  </div>;
}
