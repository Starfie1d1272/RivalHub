import Link from "next/link";
import React from "react";
import { cn } from "@/lib/utils/cn";
import { presentMatchFormat, presentMatchLabel } from "@/lib/matches/presentation";
import { Separator } from "@/components/ui/separator";
import { Panel, StatusPill } from "@/components/rivalhub";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { ScoreInput } from "@/components/matches/ScoreInput";
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
import { SOURCE_MODE_LABEL, SOURCE_HEALTH_LABEL } from "@/lib/admin/matches/source-state";
import { ManualMapTakeover } from "@/components/matches/ManualMapTakeover";
import { PerfectRoomGuide } from "@/components/matches/PerfectRoomGuide";
import { OperatorTaskControls } from "@/components/matches/OperatorTaskControls";
import { CommentaryMatchLink, MatchCommentaryStatus } from "@/components/matches/MatchCommentaryQueue";
import { mapLabel } from "@/lib/maps";
import type { AdminMatchWorkbenchData } from "@/lib/admin/matches/types";
import { getDisplayName } from "@/lib/identity/display-name";
import { getAdminMatchStartBlockers } from "@/lib/admin/matches/start-blockers";
import { formatCSTDateTime, toCSTDateTimeInput } from "@/lib/utils/date";

export type AdminMatchWorkbenchProps = AdminMatchWorkbenchData;

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
        <span className="text-xs text-[var(--color-fg-mid)]">
          {roster.status === "confirmed" ? "开赛时已定格" : "有效首发，开赛时自动核验"}
        </span>
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
  completion,
  broadcasts = [],
  uploaderDownloads,
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
  operator,
  commentary,
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

  return (
    <Panel
      contentClassName="p-3 sm:p-5 space-y-6 min-w-0"
      className={cn(
        "space-y-6",
        match.status === "in_progress" && "border-l-[3px] border-[var(--color-accent)]",
      )}
    >
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex min-w-0 flex-wrap items-center gap-3 break-words">
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

      </header>

      <Separator />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <section aria-labelledby="operator-task" className="space-y-3 rounded border border-[var(--color-border)] p-4">
        {commentary.byMatchId[match.id] && <MatchCommentaryStatus matchId={match.id} assignment={commentary.byMatchId[match.id]} />}
        <p className="text-xs text-[var(--color-fg-mid)]">当前任务</p>
        <h2 id="operator-task" className="text-lg font-semibold">{operator.workflow.title}</h2>
        <p className="text-sm text-[var(--color-fg-mid)]">{operator.workflow.description}</p>
        <p className="text-sm">下一步：{operator.workflow.nextStep}</p>
        <div className="flex flex-wrap gap-4 text-sm text-[var(--color-accent)]">
          {operator.workflow.focusMapId && <a className="underline underline-offset-4" href={`#scoreboard-${operator.workflow.focusMapId}`}>打开本图 OCR</a>}
          {operator.roomGuide && <a className="underline underline-offset-4" href="#perfect-room-guide">{operator.workflow.focusMapId ? "暂后补 OCR，查看下一图建房指引" : "查看 Perfect 建房指引"}</a>}
        </div>
        {operator.takeover && <ManualMapTakeover key={`${operator.takeover.sessionId}:${operator.takeover.mapEpoch}:${operator.takeover.mapId}:${Boolean(operator.takeover.recoverMapBinding)}`} matchId={match.id} scope={operator.takeover} mapLabel={operator.recoveryMapLabel ?? undefined} />}
        {broadcasts.length > 0 && <aside aria-label="转播状态" className="space-y-1 text-sm">{broadcasts.map((row, i) => <p key={i}>{row.name} · {row.label}</p>)}</aside>}
        <OperatorTaskControls elapsed={operator.workflow.elapsed} />
        {match.status === "in_progress" && vetoCompletedAt && operator.workflow.manualResultAllowed && <div id="manual-result" className="pt-3">
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
        </div>}
        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="mb-1 text-sm font-medium">我的下一场</p>
          {commentary.nextMatch ? <CommentaryMatchLink match={commentary.nextMatch} seasonSlug={season.slug} /> : <p className="text-sm text-[var(--color-fg-mid)]">当前没有已认领的下一场</p>}
        </div>
        {operator.roomGuide && <div id="perfect-room-guide"><PerfectRoomGuide guide={operator.roomGuide} /></div>}
      </section>
      <aside aria-label="比赛与数据源" className="space-y-3 text-sm rounded border border-[var(--color-border)] p-4 self-start">
        <p className="font-semibold">本场状态</p>
        <p>{SOURCE_MODE_LABEL[operator.workflow.sourceMode]}</p>
        <p>{SOURCE_HEALTH_LABEL[operator.workflow.sourceHealth]}</p>
        <p className="text-[var(--color-fg-mid)]">{postMatch?.commentators.length ? "已认领解说，制作资料适用" : "无人认领，制作资料不适用"}</p>
        <a className="text-[var(--color-accent)] underline" href={`/admin/${season.slug}/matches#match-resources`}>赛事运营资源</a>
      </aside>
      </div>

      {match.status === "finished" && <section aria-label="赛后完成度" className="grid gap-3 sm:grid-cols-3 text-sm">
        <p>官方比赛：{completion.official}</p>
        <p>比赛数据：{completion.data}</p>
        <p>制作资料：{completion.production}</p>
      </section>}
      {operator.workflow.completedMaps.length > 0 && match.status !== "cancelled" && (
        <section aria-labelledby="operator-scoreboards" className="space-y-3">
          <h2 id="operator-scoreboards" className="font-semibold">已完成地图 · 平台计分板与 Demo</h2>
          <p className="text-sm text-[var(--color-fg-mid)]">图间可去 Perfect 查看本图数据并截图 OCR，也可赛后补齐。补录不阻断下一图建房或赛后资料整理。</p>
          {operator.workflow.completedMaps.map(map => <details key={map.id} id={`scoreboard-${map.id}`} open={operator.workflow.focusMapId === map.id} className="rounded border border-[var(--color-border)] p-3">
            <summary className="cursor-pointer text-sm">Map {map.order} · {mapLabel(map.name)} · {map.scoreboardComplete ? "平台计分板已补齐" : "平台计分板待补"} · Demo {map.demoLabel}</summary>
            <div className="mt-3"><StatsOCRPanel mapId={map.id} mapName={map.name} /></div>
            {map.demoNeedsAttention && <p className="mt-2 text-sm text-[var(--color-warn)]">请检查下方 Demo 待处理项；若阵容或比分已更正，请在上传器中重新生成并同步。</p>}
          </details>)}
          {operator.workflow.isPostMatch && <div className="space-y-2 rounded border border-[var(--color-border)] p-3 text-sm">
            <p>去 Perfect 下载本场已完成地图的 Demo，再使用 RivalHub Demo Uploader 上传。上传后刷新当前任务，检查每图同步结果。</p>
            <p>原始 .dem 在本地解析，仅同步分析结果。</p>
            {uploaderDownloads ? <div className="flex flex-wrap gap-4">{(["windows", "macos"] as const).map(platform => <a key={platform} className="text-[var(--color-accent)] underline underline-offset-4" href={uploaderDownloads[platform]}>{platform === "windows" ? "Windows" : "macOS"} · 获取 Demo Uploader</a>)}</div> : <a className="text-[var(--color-accent)] underline underline-offset-4" href="https://github.com/Starfie1d1272/cs2-demo-analysis-kit/releases/latest" target="_blank" rel="noreferrer">获取 RivalHub Demo Uploader ↗</a>}
          </div>}
        </section>
      )}

      {match.status !== "cancelled" && <DemoDataReviewPanel reviews={demoReviews} />}

      <details className="space-y-4" open={match.status === "scheduled"}>
        <summary className="cursor-pointer font-semibold">首发、BP 与赛程管理</summary>
      <section aria-labelledby="match-workbench-overview" className="space-y-3">
        <div>
          <h2 id="match-workbench-overview" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
            概览与下一步
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
            本页承载本场的实际首发、BP、地图、赛果、赛后资料和恢复操作；公开比赛页仍只展示公开事实。
          </p>
        </div>
        {match.status === "scheduled" && (
          <PreMatchOperatorChecklist
            requiresPreflight={requiresPreflight}
            teamA={{
              name: teamAName,
              submitted: Boolean(teamARoster),
              confirmed: teamARoster?.status === "confirmed",
              starters: teamARoster?.starters.length ?? 0,
              preflight: teamAPreflight,
            }}
            teamB={{
              name: teamBName,
              submitted: Boolean(teamBRoster),
              confirmed: teamBRoster?.status === "confirmed",
              starters: teamBRoster?.starters.length ?? 0,
              preflight: teamBPreflight,
            }}
            mapState={completedMaps.length + pendingMaps.length > 0 ? "recorded" : "not_recorded"}
          />
        )}
        {match.status === "scheduled" && startBlockers.length > 0 && (
          <p className="text-xs leading-5 text-[var(--color-warn)]">
            下一步：{startBlockers.join("；")}
          </p>
        )}
        {match.status === "scheduled" && (
          <p className="text-xs leading-5 text-[var(--color-fg-mid)]">
            默认宽限为 15 分钟，不会自动判负。延长宽限或重新排期请使用赛程时间；需要判负时请在下方“危险操作与恢复”记录原因。
          </p>
        )}
      </section>

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
              vetoCompletedAt ? (operator.workflow.manualResultAllowed ? (
                <a href="#manual-result" className="text-sm text-[var(--color-accent)] underline">前往当前任务记录本图结果</a>
              ) : <p role="status" className="text-sm">{operator.workflow.sourceHealth === "healthy" ? "自动记录赛果，无需重复人工录分。" : "请先核对数据源与本图异常。"}</p>) : (
                <p role="status" className="rounded border border-[var(--color-warn-edge)] px-3 py-2 text-sm text-[var(--color-fg-mid)]">
                  Veto Session 已开始；完成 BP 地图计划后才能录入地图比分。
                </p>
              )
            ) : (
              <ScoreInput matchId={match.id} currentStatus={match.status} allowCancel={match.qualificationRunId === null} />
            )}
          </section>

          {postMatch && (
            <section aria-labelledby="match-workbench-postmatch" className="space-y-3">
              <h2 id="match-workbench-postmatch" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                赛后资料
              </h2>
              <PostMatchRecordPanel matchId={match.id} data={postMatch} />
            </section>
          )}

          <section aria-labelledby="match-workbench-danger" className="space-y-3 border-t border-[var(--color-danger-edge)] pt-4">
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
          </section>
        </>
      )}

      </details>

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

          {postMatch && (
            <section aria-labelledby="match-workbench-finished-postmatch" className="space-y-3">
              <h2 id="match-workbench-finished-postmatch" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                赛后资料
              </h2>
              <PostMatchRecordPanel matchId={match.id} data={postMatch} />
            </section>
          )}

          <details aria-labelledby="match-workbench-recovery" className="space-y-4 border-t border-[var(--color-danger-edge)] pt-4">
              <summary id="match-workbench-recovery" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-danger)]">
                危险操作与结果恢复
              </summary>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                下列操作会改变已完成比赛的正式事实或下游运行时；按现有更正与 recovery 流程执行，不直接修改 projection。
              </p>
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
          </details>
        </>
      )}

      {match.status === "cancelled" && (
        <p className="text-sm text-[var(--color-fg-mid)]">
          本场已取消，没有可执行的首发、BP、结果或赛后操作。
        </p>
      )}

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
