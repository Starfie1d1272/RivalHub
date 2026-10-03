"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { VETO_ACTION_HELP } from "@/lib/matches/veto-presentation";
import { InlineConfirm } from "@/components/rivalhub/InlineConfirm";
import { useVisiblePolling } from "@/components/use-visible-polling";
import type { VetoRoomView } from "@/lib/matches/veto-room/read-model";
import type { ActionResult } from "@/types/action";
import {
  claimVetoRepresentativeAction,
  pauseVetoRoomAction,
  performVetoRoomCommand,
  readVetoRoom,
  reconcileVetoRoomAction,
  requestVetoRoomStart,
  resolveVetoRoomAppeal,
  resumeVetoRoomAction,
  rewindVetoRoomAction,
  setManualVetoPrivilege,
  submitVetoRoomAppeal,
  updateVetoRepresentative,
} from "@/actions/matches/veto-room";

type MutationData = { outcome: string; room: VetoRoomView };
type MutationResult = ActionResult<MutationData>;
type MutationAction = (input: unknown) => Promise<MutationResult>;

const timeLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value))
  : "未设置";

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

export function VetoRoom({ initialRoom }: { initialRoom: VetoRoomView }) {
  const [room, setRoom] = useState(initialRoom);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [clockAnchor, setClockAnchor] = useState(() => ({
    serverNowMs: new Date(initialRoom.session.serverNow).getTime(),
    performanceNowMs: performance.now(),
  }));
  const [remainingMs, setRemainingMs] = useState(() => initialRoom.session.turnDeadlineAt
    ? new Date(initialRoom.session.turnDeadlineAt).getTime() - new Date(initialRoom.session.serverNow).getTime()
    : 0);
  const [serverNowMs, setServerNowMs] = useState(clockAnchor.serverNowMs);
  const [representatives, setRepresentatives] = useState<Record<string, string>>(() => Object.fromEntries(
    initialRoom.entries.map((entry) => [entry.id, entry.vetoRepresentativeMemberId ?? ""]),
  ));
  const [manualPrivilege, setManualPrivilege] = useState(initialRoom.session.privilegedEntryId ?? "");
  const [pauseReason, setPauseReason] = useState("");
  const [rewindReason, setRewindReason] = useState("");
  const [rewindTurn, setRewindTurn] = useState("choose-veto-team-a");
  const [confirmRewind, setConfirmRewind] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [appealReasons, setAppealReasons] = useState<Record<string, string>>({});
  const reconciledDeadlineRef = useRef<string | null>(null);
  const reconciledStartBoundaryRef = useRef<string | null>(null);
  const refreshInFlight = useRef(false);
  const explicitRefresh = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (announce = false) => {
    if (announce) { explicitRefresh.current = true; setRefreshing(true); setNotice(""); }
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const result = await readVetoRoom(room.match.id);
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      const next = result.data;
      if (explicitRefresh.current) { setError(""); setNotice("BP 信息已更新。"); }
      setRoom(next);
      setClockAnchor({ serverNowMs: new Date(next.session.serverNow).getTime(), performanceNowMs: performance.now() });
    } catch {
      setError("同步失败，请稍后重试。");
    } finally {
      refreshInFlight.current = false;
      explicitRefresh.current = false;
      setRefreshing(false);
    }
  }, [room.match.id]);

  const reconcileRoomBoundary = useCallback(async () => {
    const result = await reconcileVetoRoomAction({ matchId: room.match.id });
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setRoom(result.data.room);
    setClockAnchor({ serverNowMs: new Date(result.data.room.session.serverNow).getTime(), performanceNowMs: performance.now() });
    if (result.data.outcome === "applied") setNotice("BP 进度已更新。");
  }, [room.match.id]);

  // Keep a slow recovery read after completion/pause: administrators may rewind
  // or resume BP. Hidden tabs stop reads; returning to the tab resynchronizes.
  const quietRoom = room.session.completedAt || room.session.paused
    || room.match.statusKey === "finished" || room.match.statusKey === "cancelled";
  useVisiblePolling(refresh, quietRoom ? 60_000 : room.session.startedAt ? 2_000 : 5_000);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = clockAnchor.serverNowMs + (performance.now() - clockAnchor.performanceNowMs);
      setServerNowMs(now);
      const deadline = room.session.turnDeadlineAt ? new Date(room.session.turnDeadlineAt).getTime() : null;
      setRemainingMs(deadline === null ? 0 : deadline - now);
    }, 250);
    return () => window.clearInterval(timer);
  }, [clockAnchor, room.session.turnDeadlineAt]);

  useEffect(() => {
    const { currentTurnKey, turnDeadlineAt, startedAt, completedAt, paused } = room.session;
    if (room.match.statusKey !== "in_progress" || !currentTurnKey || !turnDeadlineAt || !startedAt || completedAt || paused) return;
    const deadlineMs = new Date(turnDeadlineAt).getTime();
    const attemptKey = `${currentTurnKey}:${deadlineMs}`;
    if (reconciledDeadlineRef.current === attemptKey) return;
    const estimatedServerNow = clockAnchor.serverNowMs + (performance.now() - clockAnchor.performanceNowMs);
    const delay = Math.max(0, deadlineMs + 2_000 - estimatedServerNow);
    const timer = window.setTimeout(() => {
      if (reconciledDeadlineRef.current === attemptKey) return;
      reconciledDeadlineRef.current = attemptKey;
      void reconcileRoomBoundary();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    clockAnchor,
    reconcileRoomBoundary,
    room.session,
    room.match.statusKey,
  ]);


  useEffect(() => {
    const { effectiveForceAt, startedAt, completedAt, previousMatchBlocker, revision } = room.session;
    if (room.match.statusKey !== "scheduled" || startedAt || completedAt || previousMatchBlocker) return;
    const requestedCount = room.entries.filter((entry) => entry.startRequested).length;
    if (requestedCount === 0) return;

    const estimatedServerNow = clockAnchor.serverNowMs + (performance.now() - clockAnchor.performanceNowMs);
    const allRequested = room.entries.length > 0 && requestedCount === room.entries.length;
    const opensAtMs = room.match.scheduledAt
      ? new Date(room.match.scheduledAt).getTime() - 15 * 60_000
      : null;
    const readyBoundaryMs = allRequested
      ? Math.max(estimatedServerNow, opensAtMs ?? estimatedServerNow)
      : null;
    const boundaryMs = readyBoundaryMs
      ?? (effectiveForceAt ? new Date(effectiveForceAt).getTime() : null);
    if (boundaryMs === null) return;

    const attemptKey = allRequested
      ? `ready:${revision}:${opensAtMs ?? "unscheduled"}`
      : `force:${boundaryMs}`;
    if (reconciledStartBoundaryRef.current === attemptKey) return;
    const delay = Math.max(0, boundaryMs - estimatedServerNow);
    const timer = window.setTimeout(() => {
      if (reconciledStartBoundaryRef.current === attemptKey) return;
      reconciledStartBoundaryRef.current = attemptKey;
      void reconcileRoomBoundary();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    clockAnchor,
    reconcileRoomBoundary,
    room.entries,
    room.match.scheduledAt,
    room.match.statusKey,
    room.session,
  ]);

  const mutate = useCallback(async (action: MutationAction, input: unknown, successMessage = "已保存。") => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await action(input);
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setRoom(result.data.room);
      setClockAnchor({ serverNowMs: new Date(result.data.room.session.serverNow).getTime(), performanceNowMs: performance.now() });
      setRepresentatives(Object.fromEntries(result.data.room.entries.map((entry) => [entry.id, entry.vetoRepresentativeMemberId ?? ""])));
      setManualPrivilege(result.data.room.session.privilegedEntryId ?? "");
      setNotice(result.data.outcome === "stale" ? "BP 状态已更新，请按当前步骤重新选择。" : successMessage);
    } catch {
      setError("操作未完成，请更新 BP 信息后重试。");
    } finally {
      setPending(false);
    }
  }, []);

  const turn = room.session;
  const match = room.match;
  const matchClosed = match.statusKey === "finished" || match.statusKey === "cancelled";
  const currentEntry = room.entries.find((entry) => entry.id === turn.currentTurnEntryId);
  const usedMaps = useMemo(() => new Set(room.steps.map((step) => step.mapName)), [room.steps]);
  const availableMaps = turn.mapPool.filter((map) => !usedMaps.has(map.name));
  const canStart = match.statusKey === "scheduled" && !turn.startedAt;
  const countdown = turn.turnDeadlineAt && turn.startedAt && !turn.paused && !matchClosed
    ? formatRemaining(remainingMs)
    : null;
  const matchCountdown = match.scheduledAt && !turn.startedAt
    ? formatRemaining(new Date(match.scheduledAt).getTime() - 15 * 60_000 - serverNowMs)
    : null;
  const turnKeys = Array.from(new Set([
    ...room.steps.map((step) => step.turnKey).filter((key): key is string => Boolean(key)),
    ...(turn.currentTurnKey && turn.currentTurnKey !== "choose-veto-team-a" ? [turn.currentTurnKey] : []),
  ]));
  const rewindOptions = [
    { key: "choose-veto-team-a", label: "重新选择先禁图队伍" },
    ...turnKeys.map((key) => {
      const recorded = room.steps.find((step) => step.turnKey === key);
      const label = recorded?.actionLabel ?? (key === turn.currentTurnKey ? turn.currentTurnLabel : null) ?? "BP 操作";
      return {
        key,
        label: key === turn.currentTurnKey && !recorded
          ? `从当前「${label}」开始重做`
          : `从「${label}」开始重做`,
      };
    }),
  ];

  const sendCommand = (command: unknown, key = turn.currentTurnKey) => {
    if (!key) return;
    void mutate(performVetoRoomCommand, {
      matchId: match.id,
      expectedRevision: turn.revision,
      expectedTurnKey: key,
      clientRequestId: crypto.randomUUID(),
      command,
    }, "操作已记录。");
  };

  return (
    <div className="space-y-6 py-8" data-testid="veto-room">
      <header className="space-y-2">
        <Link href={room.permissions.isAdmin ? `/admin/${room.seasonSlug}/matches/${match.id}` : `/${room.seasonSlug}/matches/${match.id}`} className="text-sm text-[var(--color-accent)] hover:underline">
          {room.permissions.isAdmin ? "返回比赛工作台" : "返回比赛"}
        </Link>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-fg-mid)]">{room.seasonName} · {match.stage}{match.round ? ` · 第 ${match.round} 轮` : ""}</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-fg)] sm:text-3xl">{room.entries[0]?.name} <span className="text-[var(--color-fg-dim)]">vs</span> {room.entries[1]?.name}</h1>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">地图 BP · {match.format}</p>
          </div>
          <span className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-fg-mid)]" aria-live="polite">
            {match.statusKey === "cancelled" ? "比赛已取消" : turn.completedAt ? "BP 已完成" : matchClosed ? "比赛已结束" : turn.startedAt ? turn.paused ? "BP 已暂停" : "BP 进行中" : "等待开始"}
          </span>
        </div>
      </header>

      {(notice || error) && (
        <div role={error ? "alert" : "status"} aria-live="polite" className={`rounded border px-4 py-3 text-sm ${error ? "border-[var(--color-danger-edge)] text-[var(--color-danger)]" : "border-[var(--color-ok-edge)] text-[var(--color-ok)]"}`}>
          {error || notice}
        </div>
      )}

      {canStart && (
        <Panel label="双方准备">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {room.entries.map((entry) => (
                <article key={entry.id} className="rounded border border-[var(--color-border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">{entry.name}</h2>
                    <span className="text-xs text-[var(--color-fg-mid)]">{entry.rosterStatusLabel}</span>
                  </div>
                  {entry.lineupBlocker && <p className="mt-2 text-xs text-[var(--color-warn)]">{entry.lineupBlocker}</p>}
                  <p className="mt-2 text-sm text-[var(--color-fg-mid)]">BP 负责人：{entry.vetoRepresentativeName ?? "尚未指定"}</p>
                  <details className="mt-2 text-xs text-[var(--color-fg-dim)]"><summary className="cursor-pointer">查看本场首发（{entry.starters.length} 人）</summary><p className="mt-2">{entry.starters.map((starter) => starter.name).join("、") || "待提交"}</p></details>
                  {entry.mayClaimRepresentative && (
                    <Button className="mt-3" size="sm" variant="outline" disabled={pending} onClick={() => void mutate(claimVetoRepresentativeAction, { matchId: match.id, entryId: entry.id }, "已认领 BP 负责人。")}>认领 BP 负责人</Button>
                  )}
                  {entry.mayEditRepresentative && (
                    <details className="mt-3"><summary className="cursor-pointer text-sm">更换 BP 负责人</summary><div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-[var(--color-fg-mid)]" htmlFor={`veto-rep-${entry.id}`}>指定本场负责人</label>
                      <select id={`veto-rep-${entry.id}`} className="min-h-9 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-sm" value={representatives[entry.id] ?? ""} onChange={(event) => setRepresentatives((current) => ({ ...current, [entry.id]: event.target.value }))}>
                        <option value="">选择首发队员</option>
                        {entry.starters.map((starter) => <option key={starter.id} value={starter.id}>{starter.name}</option>)}
                      </select>
                      <Button size="sm" variant="outline" disabled={pending || !representatives[entry.id]} onClick={() => void mutate(updateVetoRepresentative, { matchId: match.id, entryId: entry.id, eventRosterMemberId: representatives[entry.id] }, "BP 负责人已更新。")}>保存负责人</Button>
                    </div></details>
                  )}
                  {entry.mayRequestStart && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" disabled={pending || Boolean(entry.startRequested)} onClick={() => void mutate(requestVetoRoomStart, { matchId: match.id, entryId: entry.id, expectedRevision: turn.revision, expectedTurnKey: turn.currentTurnKey }, "已确认开始请求。")}>{entry.startRequested ? "已确认开始" : "确认开始 BP"}</Button>
                      {entry.startRequested && <span className="text-xs text-[var(--color-ok)]">已就绪</span>}
                    </div>
                  )}
                </article>
              ))}
            </div>

            {turn.manualPrivilegedSelectionRequired && room.permissions.canSetManualPrivilegedEntry && (
              <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--color-warn-edge)] p-3">
                <label htmlFor="manual-veto-privilege" className="text-sm">BP 优先权</label>
                <HelpTooltip label="BP 优先权说明" content="该队先选择自己或对手先禁图。赛事规则已确定优先权时，系统自动带入；自定义比赛由管理员指定。" />
                <select id="manual-veto-privilege" className="min-h-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-sm" value={manualPrivilege} onChange={(event) => setManualPrivilege(event.target.value)}>
                  <option value="">选择队伍</option>
                  {room.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
                <Button size="sm" variant="outline" disabled={pending || !manualPrivilege} onClick={() => void mutate(setManualVetoPrivilege, { matchId: match.id, entryId: manualPrivilege }, "已指定决定禁图顺序的队伍。")}>确认队伍</Button>
              </div>
            )}

            <div className="grid gap-2 text-sm text-[var(--color-fg-mid)] sm:grid-cols-2">
              <p>计划开始：{timeLabel(match.scheduledAt)}</p>
              {matchCountdown && <p>{matchCountdown === "00:00" ? "BP 已开放" : `距离 BP 开放 ${matchCountdown}`}</p>}
              <p>确认截止时间：{timeLabel(turn.effectiveForceAt)}</p>
              {turn.previousMatchBlocker && <p className="text-[var(--color-warn)]">等待上一场比赛结束后开始 BP。</p>}
              <p>{room.entries.map((entry) => `${entry.name}：${entry.startRequested ? "已就绪" : "等待确认"}`).join("；")}</p>
            </div>
          </div>
        </Panel>
      )}

      {turn.startedAt && (
        <Panel label={turn.completedAt ? "BP 结果" : matchClosed ? "比赛状态" : turn.paused ? "BP 已暂停" : "当前操作"}>
          <div className="space-y-4">
            {turn.paused && <p role="status" className="rounded border border-[var(--color-warn-edge)] px-3 py-2 text-sm text-[var(--color-warn)]">BP 已暂停。{turn.pauseReason ? `原因：${turn.pauseReason}` : ""}</p>}
            {turn.completedAt ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--color-ok)]">BP 已于 {timeLabel(turn.completedAt)} 完成。</p>
                <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="最终地图顺序与起始阵营">
                  {room.maps.map(map => <li key={map.id} className="rounded border border-[var(--color-border)] p-3">
                    <p className="font-semibold">Map {map.mapOrder} · {map.mapLabel}<HelpTooltip className="ml-1" label={`Map ${map.mapOrder} 起始方说明`} content="CT / T 表示各队在该图的起始阵营。" /></p>
                    {map.teamAStartSide ? <div className="mt-2 space-y-1 text-sm text-[var(--color-fg-mid)]"><p>{room.entries[0]?.name} · {map.teamAStartSide.toUpperCase()}</p><p>{room.entries[1]?.name} · {map.teamAStartSide === "ct" ? "T" : "CT"}</p></div> : <p className="mt-2 text-sm text-[var(--color-fg-mid)]">{match.formatKey === "bo5" && map.mapOrder === 5 ? "刀赛决定起始阵营" : "起始阵营待确认"}</p>}
                  </li>)}
                </ol>
              </div>
            ) : matchClosed ? <p className="text-sm text-[var(--color-fg-mid)]">本场比赛{match.statusLabel}。以下保留已完成的 BP 记录。</p> : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-panel-hi)] p-4">
                <div>
                  <p className="font-semibold text-[var(--color-fg)]">{turn.currentTurnLabel ?? "等待下一步"}{turn.currentTurnAction && <HelpTooltip className="ml-1" label="当前 BP 操作说明" content={VETO_ACTION_HELP[turn.currentTurnAction]} />}</p>
                  <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                    {currentEntry ? `${currentEntry.name}${currentEntry.vetoRoleLabel ? ` · ${currentEntry.vetoRoleLabel}` : ""}` : "系统处理"}
                    {turn.currentTurnMapLabel ? ` · ${turn.currentTurnMapLabel}` : ""}
                    {turn.currentTurnCount > 1 ? ` · 已完成 ${turn.currentTurnCompleted}/${turn.currentTurnCount}` : ""}
                  </p>
                </div>
                {countdown && <div className="text-right">
                  <p className="font-mono text-3xl tabular-nums" aria-live="off">{countdown}</p>
                  <p className="text-xs text-[var(--color-fg-dim)]">本次操作剩余时间</p>
                  {remainingMs <= 10_000 && remainingMs > 0 && (
                    <p role="status" aria-live="polite" className="mt-1 rounded border border-[var(--color-danger-edge)] px-2 py-1 text-xs font-medium text-[var(--color-danger)]">
                      {room.permissions.canOperateCurrentTurn ? "最后 10 秒，请完成当前操作。" : "本轮操作剩余 10 秒。"}
                    </p>
                  )}
                  {remainingMs <= 0 && (
                    <p role="status" aria-live="polite" className="mt-1 rounded border border-[var(--color-warn-edge)] px-2 py-1 text-xs">
                      本轮操作超时，正在更新结果。
                    </p>
                  )}
                </div>}
              </div>
            )}

            {!turn.completedAt && !turn.paused && !matchClosed && room.permissions.canOperateCurrentTurn && (
              <div
                data-testid="veto-primary-actions"
                className="sticky bottom-2 z-10 max-h-[42vh] overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 shadow-sm md:static md:max-h-none md:overflow-visible md:border-0 md:bg-transparent md:p-0 md:shadow-none"
              >
                {turn.currentTurnAction === "role_select" && (
                  <div className="flex flex-wrap gap-2" aria-label="选择先禁图队伍">
                    {room.entries.map((entry) => <Button key={entry.id} disabled={pending || remainingMs <= 0} onClick={() => sendCommand({ kind: "role_select", entryId: entry.id })}>由 {entry.name} 先禁图</Button>)}
                  </div>
                )}
                {(turn.currentTurnAction === "ban" || turn.currentTurnAction === "pick") && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={turn.currentTurnLabel ?? "地图操作"}>
                    {availableMaps.map((map) => <Button key={map.name} variant="outline" disabled={pending || remainingMs <= 0} onClick={() => sendCommand({ kind: "step", actionType: turn.currentTurnAction, mapName: map.name })}>{map.label}</Button>)}
                  </div>
                )}
                {turn.currentTurnAction === "side_pick" && (
                  <div className="flex flex-wrap gap-2" aria-label="选择地图起始方">
                    <Button variant="outline" disabled={pending || remainingMs <= 0} onClick={() => sendCommand({ kind: "step", actionType: "side_pick", side: "ct" })}>CT 开局</Button>
                    <Button variant="outline" disabled={pending || remainingMs <= 0} onClick={() => sendCommand({ kind: "step", actionType: "side_pick", side: "t" })}>T 开局</Button>
                  </div>
                )}
              </div>
            )}

            {!turn.completedAt && !turn.paused && match.statusKey !== "in_progress" && <p className="text-sm text-[var(--color-fg-mid)]">本场 BP 记录已保留，可随时查看。</p>}
            {!turn.completedAt && !turn.paused && match.statusKey === "in_progress" && !room.permissions.canOperateCurrentTurn && <p className="text-sm text-[var(--color-fg-mid)]">等待{currentEntry?.name ?? "对应队伍"}完成本轮操作。</p>}
          </div>
        </Panel>
      )}

      {turn.startedAt && <section className="grid gap-4 md:grid-cols-2" aria-label="队伍与负责人">
        {room.entries.map((entry) => (
          <Panel key={entry.id} label={entry.vetoRoleLabel ?? "队伍"}>
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{entry.name}</h2>
              <p className="text-sm text-[var(--color-fg-mid)]">BP 负责人：{entry.vetoRepresentativeName ?? "尚未指定"}</p>
              <details className="text-sm text-[var(--color-fg-mid)]"><summary className="cursor-pointer">查看首发</summary><ul className="mt-2 space-y-1">
                {entry.starters.map((starter) => <li key={starter.id}>{starter.name}{starter.isVetoRepresentative ? " · BP 负责人" : ""}</li>)}
              </ul></details>
              {entry.lineupBlocker && <p className="text-xs text-[var(--color-warn)]">{entry.lineupBlocker}</p>}
            </div>
          </Panel>
        ))}
      </section>}

      <Panel label="BP 记录">
        {room.steps.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚无操作记录。</p> : (
          <ol className="space-y-2">
            {room.steps.map((step) => <li key={step.id} className="flex flex-wrap items-center gap-x-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm"><span className="w-6 text-right text-xs tabular-nums text-[var(--color-fg-dim)]">{step.stepOrder}.</span><span className="font-mono text-xs text-[var(--color-accent)]">{step.actionLabel}</span><span className="text-[var(--color-fg-mid)]">{step.description}</span>{step.sourceLabel && <span className="ml-auto text-xs text-[var(--color-fg-dim)]">{step.sourceLabel}</span>}</li>)}
          </ol>
        )}
      </Panel>

      {room.incidents.length > 0 && (
        <Panel label={room.permissions.isAdmin || room.incidents.some(incident => incident.mayAppeal) ? "超时与申诉" : "超时记录"}>
          <ol className="space-y-4">
            {room.incidents.map((incident) => (
              <li key={incident.id} className="space-y-2 rounded border border-[var(--color-border)] p-3">
                <p className="text-sm"><strong>{incident.entryName}</strong> 超时，系统选择：{incident.selected.join("、")}</p>
                {incident.appeal ? (
                  <div className="rounded bg-[var(--color-panel-hi)] p-3 text-sm">
                    <p>{incident.appeal.statusLabel}</p>
                    {incident.appeal.reason && <p className="mt-1 text-[var(--color-fg-mid)]">申诉：{incident.appeal.reason}</p>}
                    {incident.appeal.resolutionNote && <p className="mt-1 text-[var(--color-fg-mid)]">裁定：{incident.appeal.resolutionNote}</p>}
                    {incident.appeal.mayResolve && (
                      <div className="mt-3 space-y-2">
                        <label className="block text-xs text-[var(--color-fg-mid)]" htmlFor={`resolve-note-${incident.id}`}>裁定说明</label>
                        <textarea id={`resolve-note-${incident.id}`} className="min-h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-sm" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" disabled={pending || resolutionNote.trim().length < 3} onClick={() => void mutate(resolveVetoRoomAppeal, { matchId: match.id, appealId: incident.appeal!.id, resolutionScope: "platform_or_organizer", resolutionNote }, "已接受申诉并恢复到对应回合。")}>平台/组织问题：接受并恢复</Button>
                          <Button size="sm" variant="outline" disabled={pending || resolutionNote.trim().length < 3} onClick={() => void mutate(resolveVetoRoomAppeal, { matchId: match.id, appealId: incident.appeal!.id, resolutionScope: "participant_or_unverified", resolutionNote }, "申诉已驳回。")}>队伍/未验证原因：驳回</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : incident.mayAppeal ? (
                  <details className="space-y-2">
                    <summary className="cursor-pointer text-sm text-[var(--color-accent)]">对本条超时提出申诉</summary>
                    <label htmlFor={`appeal-${incident.id}`} className="text-xs text-[var(--color-fg-mid)]">申诉原因</label>
                    <textarea id={`appeal-${incident.id}`} className="min-h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-sm" value={appealReasons[incident.id] ?? ""} onChange={(event) => setAppealReasons((current) => ({ ...current, [incident.id]: event.target.value }))} />
                    <Button size="sm" variant="outline" disabled={pending || (appealReasons[incident.id] ?? "").trim().length < 3} onClick={() => void mutate(submitVetoRoomAppeal, { matchId: match.id, incidentId: incident.id, reason: appealReasons[incident.id] }, "申诉已提交。")}>提交申诉</Button>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {room.permissions.isAdmin && match.statusKey === "in_progress" && turn.startedAt && (
        <Panel label="管理员恢复">
          <div className="grid gap-5 lg:grid-cols-2">
            {(room.permissions.canPause || room.permissions.canResume) && <div className="space-y-2">
              <h2 className="font-semibold">暂停或继续</h2>
              {room.permissions.canPause && <>
                <label htmlFor="veto-pause-reason" className="text-xs text-[var(--color-fg-mid)]">暂停原因</label>
                <textarea id="veto-pause-reason" className="min-h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-sm" value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} />
                <Button variant="outline" disabled={pending || pauseReason.trim().length < 3} onClick={() => void mutate(pauseVetoRoomAction, { matchId: match.id, reason: pauseReason }, "BP 已暂停。")}>暂停 BP</Button>
              </>}
              {room.permissions.canResume && <Button disabled={pending} onClick={() => void mutate(resumeVetoRoomAction, { matchId: match.id }, "BP 已继续。")}>继续 BP</Button>}
            </div>}
            {room.permissions.canRewind && (
              <div className="space-y-2">
                <h2 className="font-semibold">恢复到指定回合</h2>
                <label htmlFor="veto-rewind-turn" className="text-xs text-[var(--color-fg-mid)]">重做位置</label>
                <select id="veto-rewind-turn" className="min-h-10 w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-sm" value={rewindTurn} onChange={(event) => setRewindTurn(event.target.value)}>
                  {rewindOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <label htmlFor="veto-rewind-reason" className="text-xs text-[var(--color-fg-mid)]">恢复原因</label>
                <textarea id="veto-rewind-reason" className="min-h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-sm" value={rewindReason} onChange={(event) => setRewindReason(event.target.value)} />
                {!confirmRewind ? (
                  <Button variant="outline" disabled={pending || rewindReason.trim().length < 3} onClick={() => setConfirmRewind(true)}>恢复 BP 步骤</Button>
                ) : (
                  <InlineConfirm
                    danger
                    title={`确认恢复到「${rewindOptions.find((option) => option.key === rewindTurn)?.label ?? "指定回合"}」？`}
                    sub="确认后将清除所选位置及之后的 BP 结果，并暂停 BP 供双方重新核对。恢复适用于地图比赛开始前。"
                    confirmLabel="确认恢复"
                    onCancel={() => setConfirmRewind(false)}
                    onConfirm={() => {
                      if (pending) return;
                      setConfirmRewind(false);
                      void mutate(rewindVetoRoomAction, { matchId: match.id, targetTurnKey: rewindTurn, reason: rewindReason }, "BP 已恢复并暂停，请核对后继续。");
                    }}
                  />
                )}
              </div>
            )}
          </div>
          {room.permissions.isAdmin && turn.startedAt && <div className="mt-5 border-t border-[var(--color-border)] pt-4"><h2 className="mb-2 font-semibold">更换 BP 负责人</h2><div className="grid gap-3 sm:grid-cols-2">{room.entries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center gap-2"><span className="text-sm">{entry.name}</span><select aria-label={`${entry.name} BP 负责人`} className="min-h-9 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-sm" value={representatives[entry.id] ?? ""} onChange={(event) => setRepresentatives((current) => ({ ...current, [entry.id]: event.target.value }))}><option value="">选择首发队员</option>{entry.starters.map((starter) => <option key={starter.id} value={starter.id}>{starter.name}</option>)}</select><Button size="sm" variant="outline" disabled={pending || !representatives[entry.id]} onClick={() => void mutate(updateVetoRepresentative, { matchId: match.id, entryId: entry.id, eventRosterMemberId: representatives[entry.id] }, "管理员已更换 BP 负责人。")}>保存</Button></div>)}</div></div>}
        </Panel>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-fg-dim)]">
        <span>最近同步 {timeLabel(turn.serverNow)}</span>
        <Button size="sm" variant="ghost" disabled={pending || refreshing} onClick={() => void refresh(true)}>{refreshing ? "正在更新…" : "更新 BP 信息"}</Button>
      </footer>
    </div>
  );
}
