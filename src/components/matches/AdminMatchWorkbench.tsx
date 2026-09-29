import Link from "next/link";
import React from "react";
import { cn } from "@/lib/utils/cn";
import { presentMatchFormat, presentMatchLabel } from "@/lib/matches/presentation";
import { Separator } from "@/components/ui/separator";
import { Panel, StatusPill } from "@/components/rivalhub";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { MapByMapInput } from "@/components/matches/MapByMapInput";
import { ScheduledAtInput } from "@/components/matches/ScheduledAtInput";
import { VetoInputDialog } from "@/components/matches/VetoInputDialog";
import { AdminRosterDialog } from "@/components/matches/AdminRosterDialog";
import { ResultCorrectionPanel } from "@/components/matches/ResultCorrectionPanel";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { ForfeitButton } from "@/components/matches/ForfeitButton";
import { MapScoreCorrectInput } from "@/components/matches/MapScoreCorrectInput";
import { DeleteMatchButton } from "@/components/matches/DeleteMatchButton";
import { CompletedAtInput } from "@/components/matches/CompletedAtInput";
import { PreMatchOperatorChecklist } from "@/components/matches/PreMatchOperatorChecklist";
import { PostMatchRecordPanel } from "@/components/matches/PostMatchRecordPanel";
import { DemoDataReviewPanel } from "@/components/matches/DemoDataReviewPanel";
import type { AdminMatchWorkbenchData } from "@/lib/admin/matches/types";
import { getDisplayName } from "@/lib/identity/display-name";
import { getAdminMatchStartBlockers } from "@/lib/admin/matches/start-blockers";
import { formatCSTDateTime, toCSTDateTimeInput } from "@/lib/utils/date";
import { projectMatchPrimaryTask } from "@/lib/matches/runtime-presentation";
import type { loadMatchRuntimePresentation } from "@/lib/matches/runtime-read-model";
import { ManualMapTakeover } from "./ManualMapTakeover";

export type AdminMatchWorkbenchProps = AdminMatchWorkbenchData & { runtime: Awaited<ReturnType<typeof loadMatchRuntimePresentation>> };

function RosterSummary({
  teamName,
  members,
  roster,
}: {
  teamName: string;
  members: AdminMatchWorkbenchData["teamAMembers"];
  roster: AdminMatchWorkbenchData["teamARoster"];
}) {
  if (!roster) {
    return (
      <div className="rounded border border-[var(--color-border)] p-3 text-sm">
        <p className="font-medium">{teamName}</p>
        <p className="mt-1 text-xs text-[var(--color-warn)]">尚未提交本场首发</p>
      </div>
    );
  }

  const memberMap = new Map(members.map((member) => [member.id, member]));
  const labelMembers = (ids: string[]) => ids.map((id) => {
    const member = memberMap.get(id);
    return member ? getDisplayName(member) : "未知队员";
  }).join("、");

  return (
    <div className="rounded border border-[var(--color-border)] p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{teamName}</p>
        <span className="text-xs text-[var(--color-fg-mid)]">{roster.status === "confirmed" ? "已定格" : "当前首发"}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-fg-mid)]">
        首发：{labelMembers(roster.starters) || "—"}
      </p>
      {roster.substitutes.length > 0 && (
        <p className="text-xs leading-5 text-[var(--color-fg-mid)]">
          替补：{labelMembers(roster.substitutes)}
        </p>
      )}
    </div>
  );
}

/**
 * The single-match operator surface. All detail and mutation components stay
 * on this route so the season overview remains a summary-only read model.
 */
export function AdminMatchWorkbench({
  season,
  stageName,
  match,
  teamAName,
  teamBName,
  mapPool,
  teamAMembers,
  teamBMembers,
  teamARoster,
  teamBRoster,
  teamAPreflight,
  teamBPreflight,
  completedMaps,
  pendingMaps,
  finishedMaps,
  vetoCompletedAt,
  postMatch,
  demoReviews = [],
  runtime,
}: AdminMatchWorkbenchProps) {
  const requiresPreflight = match.ownership === "major_stage";
  const startBlockers = getAdminMatchStartBlockers({
    requiresPreflight,
    teamAName,
    teamBName,
    teamARoster,
    teamBRoster,
    teamAPreflight,
    teamBPreflight,
  });
  const matchLabel = presentMatchLabel({
    stage: match.stage,
    stageName,
    round: match.round,
    entryRound: match.entryRound,
    teamAName,
    teamBName,
  });
  const task = runtime ? projectMatchPrimaryTask({ phase: runtime.phase, needsAttention: runtime.needsAttention, scheduledAt: match.scheduledAt, isAdmin: true, isTeamRepresentative: false, isBpRepresentative: false, lineupsReady: runtime.lineupsReady }) : { key: "none", label: "" };

  return (
    <Panel
      contentClassName="p-5"
      className={cn(
        "space-y-6",
        match.status === "in_progress" && "border-l-[3px] border-[var(--color-accent)]",
      )}
    >
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">{teamAName}</span>
            <span className="text-[var(--color-fg-mid)]">
              {match.status === "finished" ? `${match.scoreA ?? 0} : ${match.scoreB ?? 0}` : "vs"}
            </span>
            <span className="text-lg font-semibold">{teamBName}</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill {...presentMatchFormat(match.format)} />
            <MatchStatusBadge
              status={match.status}
              isForfeit={match.isForfeit}
              scheduledAt={match.scheduledAt}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
          <span>{matchLabel}</span>
          <span>排期：{match.scheduledAt ? formatCSTDateTime(match.scheduledAt) : "尚未排期"}</span>
          {match.completionDeadline && <span>截止：{formatCSTDateTime(match.completionDeadline)}</span>}
        </div>
        <Link
          href={`/admin/${season.slug}/matches`}
          className="inline-flex text-sm text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          ← 回到赛事比赛总览
        </Link>
      </header>

      <Separator />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <main className="min-w-0 space-y-6">
      {match.status !== "cancelled" && (
        <section aria-labelledby="match-workbench-lineup" className="space-y-3">
          <div>
            <h2 id="match-workbench-lineup" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
              首发名单
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
              这里记录本场实际出场阵容；可与赛事主力名单不同，但只能从已锁定的本届名单中选择。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RosterSummary teamName={teamAName} members={teamAMembers} roster={teamARoster} />
            <RosterSummary teamName={teamBName} members={teamBMembers} roster={teamBRoster} />
          </div>
          {match.status !== "finished" && (
            <AdminRosterDialog
              matchId={match.id}
              teamAName={teamAName}
              teamBName={teamBName}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
              teamAMembers={teamAMembers}
              teamBMembers={teamBMembers}
              teamARoster={teamARoster}
              teamBRoster={teamBRoster}
              allowSubstitutes={match.ownership !== "major_stage"}
            />
          )}
        </section>
      )}

      {match.status !== "cancelled" && match.status !== "finished" && (
        <>
          <section aria-labelledby="match-workbench-maps" className="space-y-3">
            <div>
              <h2 id="match-workbench-maps" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                BP、地图与比赛时间
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                双方在 Veto Room 完成禁选后，再按地图录入回合比分；系统将自动计算系列赛比分。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="inline-flex min-h-10 items-center rounded border border-[var(--color-border)] px-4 text-sm font-medium hover:border-[var(--color-border-hover)]" href={`/${season.slug}/matches/${match.id}/veto`}>
                {match.status === "scheduled" ? "打开 Veto Room" : "查看 Veto Room"}
              </Link>
            </div>
            <ScheduledAtInput
              matchId={match.id}
              currentScheduledAt={match.scheduledAt}
              currentCompletionDeadline={match.completionDeadline}
            />
            {match.status === "in_progress" ? (
              vetoCompletedAt ? (
                <MapByMapInput
                  matchId={match.id}
                  format={match.format}
                  teamAName={teamAName}
                  teamBName={teamBName}
                  entryAId={match.entryAId}
                  entryBId={match.entryBId}
                  completedMaps={completedMaps}
                  pendingMaps={pendingMaps}
                  mapPool={mapPool}
                />
              ) : (
                <p role="status" className="rounded border border-[var(--color-warn-edge)] px-3 py-2 text-sm text-[var(--color-fg-mid)]">
                  Veto Session 已开始；完成 BP 地图计划后才能录入地图比分。
                </p>
              )
            ) : <p className="text-sm text-[var(--color-fg-mid)]">从 BP 房间开始比赛；若赛事已实际开始但未留下正常开赛记录，请处理现场异常。</p>}
          </section>

          {postMatch && (
            <section aria-labelledby="match-workbench-postmatch" className="space-y-3">
              <h2 id="match-workbench-postmatch" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                赛后资料
              </h2>
              <PostMatchRecordPanel matchId={match.id} data={postMatch} />
            </section>
          )}

          <details className="border-t border-[var(--color-danger-edge)] pt-4"><summary className="cursor-pointer text-sm text-[var(--color-danger)]">判负与异常处理</summary><section aria-labelledby="match-workbench-danger" className="mt-3 space-y-3">
            <div>
              <h2 id="match-workbench-danger" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-danger)]">
                危险操作与恢复
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                判负会写入正式结果并审计；请先确认赛程调整无法解决问题，再选择弃赛方并填写原因。
              </p>
            </div>
            <ForfeitButton
              matchId={match.id}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
              teamAName={teamAName}
              teamBName={teamBName}
            />
          </section></details>
        </>
      )}

      {match.status === "finished" && (
        <>
          <section aria-labelledby="match-workbench-finished-maps" className="space-y-3">
            <div>
              <h2 id="match-workbench-finished-maps" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                BP 与已完成地图
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                赛后可查看或补录 BP；实际地图回合比分仍是赛果的底层事实。
              </p>
            </div>
            <VetoInputDialog
              matchId={match.id}
              format={match.format}
              teamAName={teamAName}
              teamBName={teamBName}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
              mapPool={mapPool}
              matchStatus="finished"
            />
            {finishedMaps.length === 0 && (
              <p className="text-xs leading-5 text-[var(--color-fg-mid)]">
                {match.isForfeit ? "本场为弃赛，无实际进行的地图，不提供地图比分或 Stats OCR。" : "本场没有已记录的实际地图比分。"}
              </p>
            )}
          </section>

          <DemoDataReviewPanel reviews={demoReviews} />

          {postMatch && (
            <section aria-labelledby="match-workbench-finished-postmatch" className="space-y-3">
              <h2 id="match-workbench-finished-postmatch" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                赛后资料与 OCR
              </h2>
              <PostMatchRecordPanel matchId={match.id} data={postMatch} />
              {finishedMaps.map((map) => (
                <div key={map.id}>
                  <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
                </div>
              ))}
            </section>
          )}

          <details className="border-t border-[var(--color-danger-edge)] pt-4"><summary className="cursor-pointer text-sm text-[var(--color-danger)]">结果更正与恢复</summary><section aria-labelledby="match-workbench-recovery" className="mt-3 space-y-4">
            <div>
              <h2 id="match-workbench-recovery" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-danger)]">
                危险操作与结果恢复
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                下列操作会改变已完成比赛的正式事实或下游运行时；按现有更正与 recovery 流程执行，不直接修改 projection。
              </p>
            </div>
            {finishedMaps.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--color-fg-mid)]">逐图比分（修改后大比分自动更新）</p>
                {finishedMaps.map((map) => (
                  <MapScoreCorrectInput
                    key={map.id}
                    mapId={map.id}
                    mapName={map.mapName}
                    scoreA={map.scoreA}
                    scoreB={map.scoreB}
                    teamAName={teamAName}
                    teamBName={teamBName}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs leading-5 text-[var(--color-fg-mid)]">
                没有实际地图比分，不能通过系列赛比分直接修改。
              </p>
            )}
            <ResultCorrectionPanel
              matchId={match.id}
              teamAName={teamAName}
              teamBName={teamBName}
              format={match.format}
            />
            <CompletedAtInput
              matchId={match.id}
              initialValue={toCSTDateTimeInput(match.completedAt)}
            />
          </section></details>
        </>
      )}

      {match.status === "cancelled" && (
        <p className="text-sm text-[var(--color-fg-mid)]">
          本场已取消，没有可执行的首发、BP、结果或赛后操作。
        </p>
      )}

      </main>
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="比赛状态与准备情况">
        <Panel label="当前阶段" contentClassName="space-y-3 p-4">
          <p className="text-lg font-semibold">{runtime?.phaseLabel ?? "赛前准备"}</p>
          {task.key !== "none" && <p className="text-sm text-[var(--color-accent)]">下一步：{task.label}</p>}
          {runtime?.source ? <p className={`text-sm ${runtime.needsAttention ? "text-[var(--color-warn)]" : "text-[var(--color-fg-mid)]"}`}>{runtime.source.deviceName} · {runtime.source.label}</p> : <p className="text-sm text-[var(--color-fg-mid)]">本场没有制播设备，按正常人工赛务处理。</p>}
          {runtime?.source && match.status === "in_progress" && <ManualMapTakeover matchId={match.id} seasonId={season.id} />}
        </Panel>
        {match.status === "scheduled" && <PreMatchOperatorChecklist requiresPreflight={requiresPreflight}
          teamA={{ name: teamAName, submitted: Boolean(teamARoster), confirmed: false, starters: teamARoster?.starters.length ?? 0, preflight: teamAPreflight }}
          teamB={{ name: teamBName, submitted: Boolean(teamBRoster), confirmed: false, starters: teamBRoster?.starters.length ?? 0, preflight: teamBPreflight }}
          mapState={completedMaps.length + pendingMaps.length > 0 ? "recorded" : "not_recorded"} />}
        {startBlockers.length > 0 && <p className="text-xs text-[var(--color-warn)]">需要处理：{startBlockers.join("；")}</p>}
      </aside>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <Link
          href={`/${season.slug}/matches/${match.id}`}
          className="text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          target="_blank"
          rel="noreferrer"
        >
          查看公开页 ↗
        </Link>
        {match.bracketNodeId == null && match.qualificationRunId === null && <DeleteMatchButton matchId={match.id} />}
      </footer>
    </Panel>
  );
}
