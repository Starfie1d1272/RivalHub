import { hasMatchRecording } from "@/lib/postmatch/recording-types";
import { MatchDownloads } from "@/components/matches/MatchDownloads";
import { requiresCompetitionLineupPreflight } from "@/lib/match-rosters/policy";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { OfficialMapStart } from "@/components/bet/OfficialMapStart";
import { OperatorLiveStatus } from "./OperatorLiveStatus";
import { OperatorIssuePanel } from "./OperatorIssuePanel";
import Link from "next/link";
import React from "react";
import { presentMatchFormat } from "@/lib/matches/presentation";
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
import { projectOperatorPostMatchTasks } from "@/lib/admin/matches/operator-workflow";
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
  teamName, entryId,
  members,
  roster,
}: {
  teamName: string; entryId: string;
  members: AdminMatchWorkbenchData["teamAMembers"];
  roster: AdminMatchWorkbenchData["teamARoster"];
}) {
  if (!roster) {
    return (
      <div className="rounded border border-[var(--color-border)] p-3 text-sm">
        <p className="font-medium"><TeamProfileLink entryId={entryId}>{teamName}</TeamProfileLink></p>
        <p className="mt-1 text-xs text-[var(--color-warn)]">尚未提交本场首发</p>
      </div>
    );
  }

  const memberMap = new Map(members.map((member) => [member.id, member]));
  const labelMembers = (ids: string[]) => ids.map((id, index) => {
    const member = memberMap.get(id);
    return <span key={id}>{index > 0 && "、"}{member ? <PlayerProfileLink userId={member.userId}>{getDisplayName(member)}</PlayerProfileLink> : "未知队员"}</span>;
  });

  return (
    <div className="rounded border border-[var(--color-border)] p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium"><TeamProfileLink entryId={entryId}>{teamName}</TeamProfileLink></p>
        <span className="text-xs text-[var(--color-fg-mid)]">
          {roster.status === "confirmed" ? "已定格" : "待开赛核验"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-fg-mid)]">
        首发：{roster.starters.length ? labelMembers(roster.starters) : "—"}
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
  officialMapStart,
  postMatch,
  demoReviews = [],
  demoQuality = [],
  operator,
  commentary,
}: AdminMatchWorkbenchProps) {
  const requiresPreflight = requiresCompetitionLineupPreflight(match);
  const startBlockers = getAdminMatchStartBlockers({
    requiresPreflight,
    teamAName,
    teamBName,
    teamARoster,
    teamBRoster,
    teamAPreflight,
    teamBPreflight,
  });
  const postMatchTasks = projectOperatorPostMatchTasks({
    status: match.status, isForfeit: match.isForfeit,
    maps: operator.workflow.completedMaps,
    commentatorCount: postMatch?.commentators.length ?? 0,
    submitted: Boolean(postMatch?.submittedAt),
    hasVideo: hasMatchRecording({ videoUrl: postMatch?.videoUrl ?? null, recordings: postMatch?.recordings }), reopened: postMatch?.rosterReopened,
  });
  const taskTitle = match.status === "finished" && operator.workflow.reviewReasons.length === 0
    ? (postMatchTasks.length ? "补齐赛后资料" : "本场已完成")
    : operator.workflow.title;

  return (
    <Panel contentClassName="p-3 sm:p-5 space-y-4 min-w-0">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex min-w-0 flex-wrap items-center gap-3 break-words">
            <TeamProfileLink seasonSlug={season.slug} entryId={match.entryAId} className="min-w-0 max-w-full text-xl sm:text-2xl font-semibold [overflow-wrap:anywhere]">{teamAName}</TeamProfileLink>
            <span className="text-[var(--color-fg-mid)]">
              {match.status === "finished" ? `${match.scoreA ?? "—"} : ${match.scoreB ?? "—"}` : "vs"}
            </span>
            <TeamProfileLink seasonSlug={season.slug} entryId={match.entryBId} className="min-w-0 max-w-full text-xl sm:text-2xl font-semibold [overflow-wrap:anywhere]">{teamBName}</TeamProfileLink>
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
          <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">{stageName ?? match.stage}{match.round != null ? ` · 第 ${match.round} 轮` : match.entryRound ? ` · ${match.entryRound}` : ""}</span>
          <span>排期：{match.scheduledAt ? formatCSTDateTime(match.scheduledAt) : "尚未排期"}</span>
          {match.completionDeadline && <span>截止：{formatCSTDateTime(match.completionDeadline)}</span>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
        {commentary.byMatchId[match.id] && <MatchCommentaryStatus matchId={match.id} assignment={commentary.byMatchId[match.id]} />}
        {broadcasts.length > 0 && <aside aria-label="转播状态" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">{broadcasts.map((row, i) => <span key={i}>直播：{row.name} · {row.label}</span>)}</aside>}
        </div>
      </header>

      <Separator />


      <section aria-labelledby="operator-task" className="space-y-3 rounded border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent)] bg-[var(--color-bg)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="operator-task" className="text-xl font-semibold">{taskTitle}</h2>
          <OperatorTaskControls elapsed={operator.workflow.elapsed} />
        </div>
        {match.status === "scheduled" && startBlockers.length > 0 && <p className="text-sm text-[var(--color-warn)]">{startBlockers.join("；")}</p>}
        {operator.workflow.primaryTask === "source_check" && <p className="text-sm text-[var(--color-warn)]">{operator.workflow.description}</p>}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {match.status !== "cancelled" && <Link className={vetoCompletedAt || match.status === "finished" ? "text-[var(--color-fg-mid)] underline underline-offset-4" : "inline-flex min-h-10 items-center rounded bg-[var(--color-accent)] px-4 font-medium text-[var(--color-accent-fg)]"} href={`/${season.slug}/matches/${match.id}/veto`}>{vetoCompletedAt || match.status === "finished" ? "查看 BP" : "进入 BP"}</Link>}
          {operator.workflow.focusMapId && match.status !== "finished" && <a className="text-[var(--color-accent)] underline underline-offset-4" href={`#scoreboard-${operator.workflow.focusMapId}`}>补计分板</a>}
        {officialMapStart && <OfficialMapStart seasonId={season.id} matchId={match.id} mapId={officialMapStart.mapId} mapName={officialMapStart.mapName} />}
          {postMatchTasks.map(task => <a key={`${task.anchor}:${task.label}`} className="text-[var(--color-accent)] underline underline-offset-4" href={`#${task.anchor}`}>{task.label}</a>)}
        </div>
        {operator.review && <OperatorIssuePanel reasons={operator.workflow.reviewReasons} review={operator.review} />}
        {operator.takeover ? <ManualMapTakeover key={`${operator.takeover.sessionId}:${operator.takeover.mapEpoch}:${operator.takeover.mapId}:${Boolean(operator.takeover.recoverMapBinding)}`} matchId={match.id} scope={operator.takeover} mapLabel={operator.recoveryMapLabel ?? undefined} /> : operator.problemRecovery ? <ManualMapTakeover
          key={`${operator.problemRecovery.sessionId}:${operator.problemRecovery.mapEpoch}:${operator.problemRecovery.reportContext.programSourceGeneration}:${operator.problemRecovery.reportContext.lastReliableSeq}:${operator.problemRecovery.mapId}`}
          matchId={match.id} scope={{ sessionId: operator.problemRecovery.sessionId, mapEpoch: operator.problemRecovery.mapEpoch, mapId: operator.problemRecovery.mapId, recoverMapBinding: operator.problemRecovery.recoverMapBinding }}
          reportContext={operator.problemRecovery.reportContext} mapLabel={operator.problemRecovery.mapLabel} /> : null}
        {operator.roomGuide && <div id="perfect-room-guide"><PerfectRoomGuide guide={operator.roomGuide} /></div>}
        {vetoCompletedAt && ((match.status === "in_progress" && operator.workflow.manualResultAllowed) || (match.testConfig && match.status === "finished" && match.resultDisposition !== "omitted" && pendingMaps.length > 0)) && <details id="manual-result" className="space-y-3 pt-3" open={operator.workflow.sourceMode === "manual_map" || operator.workflow.phase === "gameplay"}>
          <summary className="cursor-pointer text-sm font-medium">录入本图比分</summary>
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
        </details>}
      </section>
      <aside aria-label="比赛与数据源" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-fg-mid)]">
        <span>{SOURCE_MODE_LABEL[operator.workflow.sourceMode]}</span>
        {operator.liveScope && operator.workflow.sourceMode === "mizar_auto" && !operator.workflow.reviewReasons.length
          ? <OperatorLiveStatus matchId={match.id} scope={operator.liveScope} />
          : <span>{SOURCE_HEALTH_LABEL[operator.workflow.sourceHealth]}</span>}
        {commentary.nextMatch && <div className="flex flex-wrap items-center gap-2">下一场：<CommentaryMatchLink match={commentary.nextMatch} seasonSlug={season.slug} /></div>}
        <a className="ml-auto underline underline-offset-4" href={`/admin/${season.slug}/matches#match-resources`}>设备与下载</a>
      </aside>

      {match.status === "finished" && <section aria-label="赛后完成度" className="grid gap-3 sm:grid-cols-3 text-sm">
        <p>官方比赛：{completion.official}</p>
        <p>比赛数据：{completion.data}</p>
        <p>解说与录像：{completion.production}</p>
      </section>}
      {match.status === "finished" && postMatch && <details id="match-workbench-finished-postmatch" open={postMatchTasks.some(task => task.anchor === "match-workbench-finished-postmatch")} className="space-y-3 rounded border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer font-medium">解说与录像</summary>
        <PostMatchRecordPanel matchId={match.id} data={postMatch} />
      </details>}
      {operator.workflow.completedMaps.length > 0 && match.status !== "cancelled" && (
        <section aria-labelledby="operator-scoreboards" className="space-y-3">
          <h2 id="operator-scoreboards" className="font-semibold">地图数据</h2>
          {operator.workflow.completedMaps.map(map => <details key={map.id} id={`scoreboard-${map.id}`} open={operator.workflow.focusMapId === map.id} className="rounded border border-[var(--color-border)] p-3">
            <summary className="cursor-pointer text-sm">Map {map.order} · {mapLabel(map.name)} · {map.scoreboardComplete ? "计分板 ✓" : "待补计分板"} · Demo {map.demoLabel}</summary>
            <div className="mt-3"><StatsOCRPanel mapId={map.id} mapName={map.name} /></div>
            {map.demoNeedsAttention && <p className="mt-2 text-sm text-[var(--color-warn)]">请检查下方 Demo 待处理项；若阵容或比分已更正，请在上传器中重新生成并同步。</p>}
          </details>)}
          {operator.workflow.isPostMatch && <details className="space-y-2 rounded border border-[var(--color-border)] p-3 text-sm">
            <summary className="cursor-pointer">上传 Demo</summary>
            <p className="text-[var(--color-fg-mid)]">从 Perfect 下载 Demo，用上传器同步。本地解析，不上传原始文件。</p>
            <MatchDownloads downloads={uploaderDownloads ?? null} />
          </details>}
        </section>
      )}

      {finishedMaps.length > 0 && ["in_progress", "finished"].includes(match.status) && <details aria-label="比分更正与系列恢复" className="space-y-3 rounded border border-[var(--color-border)] p-3">
        <summary className="cursor-pointer text-sm font-medium">比分更正与系列恢复</summary>
        {finishedMaps.map(map => <div key={`${map.id}:${map.scoreA}:${map.scoreB}`} className="pt-2">
          <p className="mb-2 text-sm">{mapLabel(map.mapName)} · {map.scoreA} : {map.scoreB}</p>
          <MapScoreCorrectInput entryAId={match.entryAId} entryBId={match.entryBId} seasonSlug={season.slug} matchId={match.id} matchInProgress={match.status === "in_progress"} mapId={map.id} mapName={map.mapName} scoreA={map.scoreA} scoreB={map.scoreB} teamAName={teamAName} teamBName={teamBName} />
        </div>)}
      </details>}

      {match.status !== "cancelled" && <DemoDataReviewPanel reviews={demoReviews} quality={demoQuality} />}

      {match.status !== "cancelled" && <details id="match-lineups" className="space-y-4 rounded border border-[var(--color-border)] p-4" open={match.status === "scheduled"}>
        <summary className="cursor-pointer font-semibold">首发、BP 与赛程管理</summary>
      {
        <section aria-labelledby="match-workbench-lineup" className="space-y-3">
          <div>
            <h2 id="match-workbench-lineup" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
              首发名单
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RosterSummary entryId={match.entryAId} teamName={teamAName} members={teamAMembers} roster={teamARoster} />
            <RosterSummary entryId={match.entryBId} teamName={teamBName} members={teamBMembers} roster={teamBRoster} />
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
      }

      {match.status !== "finished" && (
        <>
          <section aria-labelledby="match-workbench-maps" className="space-y-3">
            <div>
              <h2 id="match-workbench-maps" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">
                BP、地图与比赛时间
              </h2>
            </div>
            <ScheduledAtInput
              matchId={match.id}
              currentScheduledAt={match.scheduledAt}
              currentCompletionDeadline={match.completionDeadline}
            />
            {match.status === "in_progress" ? (
              vetoCompletedAt ? (operator.workflow.manualResultAllowed ? (
                <a href="#manual-result" className="text-sm text-[var(--color-accent)] underline">前往当前任务记录本图结果</a>
              ) : <p role="status" className="text-sm">{operator.workflow.sourceHealth === "healthy" ? "本图采用 Mizar 自动赛果。" : "请先核对数据源与本图异常。"}</p>) : (
                <p role="status" className="rounded border border-[var(--color-warn-edge)] px-3 py-2 text-sm text-[var(--color-fg-mid)]">
                  BP 正在进行，完成后按地图计划建房。
                </p>
              )
            ) : (
              <ScoreInput matchId={match.id} currentStatus={match.status} allowCancel={match.qualificationRunId === null} />
            )}
          </section>



          <details className="space-y-3 border-t border-[var(--color-danger-edge)] pt-3">
            <summary className="cursor-pointer text-sm text-[var(--color-danger)]">弃赛 / 判负</summary>
            <div>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                判负将写入正式结果。请先核对排期，再选择弃赛方并填写原因。
              </p>
            </div>
            <ForfeitButton
              matchId={match.id}
              entryAId={match.entryAId}
              entryBId={match.entryBId}
              teamAName={teamAName}
              teamBName={teamBName}
            />
          </details>
        </>
      )}

      </details>}

      {match.status === "finished" && (
        <>
          <details id="match-workbench-finished-maps" className="space-y-3 rounded border border-[var(--color-border)] p-3">
            <summary className="cursor-pointer text-sm font-medium">补录线下 BP</summary>
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
                {match.isForfeit ? "本场已记录弃赛结果。" : "本场没有已记录的实际地图比分。"}
              </p>
            )}
          </details>

          <details aria-labelledby="match-workbench-recovery" className="space-y-4 border-t border-[var(--color-danger-edge)] pt-4">
              <summary id="match-workbench-recovery" className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-danger)]">
                危险操作与结果恢复
              </summary>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">
                更正整场结果前，请核对影响的后续赛程。
              </p>
            {!match.testConfig && <ResultCorrectionPanel entryAId={match.entryAId} entryBId={match.entryBId} seasonSlug={season.slug}
              matchId={match.id}
              teamAName={teamAName}
              teamBName={teamBName}
              format={match.format}
            />}
            <CompletedAtInput
              matchId={match.id}
              initialValue={toCSTDateTimeInput(match.completedAt)}
            />
          </details>
        </>
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
        {match.status === "scheduled" && match.ownership === "manual" && match.bracketNodeId == null && match.qualificationRunId === null && <DeleteMatchButton matchId={match.id} />}
      </footer>
    </Panel>
  );
}
