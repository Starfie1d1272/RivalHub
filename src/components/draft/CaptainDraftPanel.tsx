"use client";

import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { useClientReady } from "@/components/rivalhub/useClientReady";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Clock, Loader2, Search, Zap } from "lucide-react";
import { pickPlayer } from "@/actions/draft";
import { Button } from "@/components/ui/button";
import { DraftCountdown } from "./DraftCountdown";
import { canPickPosition } from "@/lib/draft/rules";
import { positionLabel } from "@/lib/validators/registration";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PosChip } from "@/components/rivalhub/PosChip";
import { useRoutePolling } from "@/components/use-visible-polling";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { sortByRank } from "@/lib/utils/rank";
import { selectAutoPickCandidate } from "@/lib/draft/auto-pick";
import type { CaptainDraftPlayer } from "@/lib/draft/data";

const FILTER_ALL = "all";

interface CaptainDraftPanelProps {
  seasonId: string;
  entryId: string;
  teamName: string;
  currentTeamName: string | null;
  currentEntryId?: string | null;
  currentRound: number | null;
  roundDeadline: string | null;
  isDraftActive: boolean;
  isCurrentCaptainTurn: boolean;
  positionCounts: Record<string, number>;
  players: CaptainDraftPlayer[];
  seasonPositions: string[];
  /** Already picked members for roster summary */
  rosterMembers: { userId: string; personaName: string | null; avatarUrl: string | null; perfectName: string | null; displayName: string | null; primaryPosition: string }[];
  captainPosition: string;
  readonly?: boolean;
}

export function CaptainDraftPanel({
  seasonId,
  entryId,
  teamName,
  currentTeamName, currentEntryId,
  currentRound,
  roundDeadline,
  isDraftActive,
  isCurrentCaptainTurn,
  positionCounts,
  players,
  seasonPositions,
  rosterMembers,
  captainPosition,
  readonly: isReadonly,
}: CaptainDraftPanelProps) {
  const router = useRouter();
  const interactive = useClientReady();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [search, setSearch] = useState("");
  const [pendingRegistrationId, setPendingRegistrationId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspected = players.find(player => player.registrationId === inspectedId) ?? null;
  useRoutePolling(isReadonly ? null : 10_000, pendingRegistrationId !== null);

  const grouped = useMemo(() => {
    const map = new Map<string, CaptainDraftPlayer[]>();
    for (const player of players) {
      const list = map.get(player.primaryPosition) ?? [];
      list.push(player);
      map.set(player.primaryPosition, list);
    }
    return map;
  }, [players]);

  const positionOptions = useMemo(() => {
    const ordered = [...seasonPositions];
    for (const position of grouped.keys()) {
      if (!ordered.includes(position)) ordered.push(position);
    }
    return ordered;
  }, [grouped, seasonPositions]);

  const sortedPlayers = useMemo(() => {
    let filtered =
      filter === FILTER_ALL
        ? players
        : players.filter((player) => player.primaryPosition === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((player) => {
        const name = getPublicDisplayName(player).toLowerCase();
        return name.includes(q);
      });
    }
    return sortByRank(filtered);
  }, [players, filter, search]);

  // Auto-pick candidate hint (resolve full player for display name)
  const autoPickCandidate = useMemo(() => {
    if (!isDraftActive || !isCurrentCaptainTurn) return null;
    const candidate = selectAutoPickCandidate(players, positionCounts);
    if (!candidate) return null;
    return players.find((p) => p.registrationId === candidate.registrationId) ?? null;
  }, [players, positionCounts, isDraftActive, isCurrentCaptainTurn]);

  const canSubmit = interactive && isDraftActive && isCurrentCaptainTurn && pendingRegistrationId === null;

  async function handlePick(player: CaptainDraftPlayer) {
    if (!canSubmit || !canPickPosition(positionCounts[player.primaryPosition] ?? 0)) return;

    setPendingRegistrationId(player.registrationId);
    setMessage(null);

    const result = await pickPlayer({
      seasonId,
      entryId,
      registrationId: player.registrationId,
      clientRequestId: crypto.randomUUID(),
    });

    setPendingRegistrationId(null);
    if (!result.success) {
      setMessage({ type: "error", text: result.error.message });
      return;
    }

    setMessage({
      type: "success",
      text: result.data.completed
        ? "选秀已完成"
        : `${getPublicDisplayName(player)} 已加入队伍`,
    });
    router.refresh();
  }

  return (
    <div className="grid items-start gap-5 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      {/* Header */}
      {!isReadonly && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4 md:col-span-2 xl:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-fg)]"><TeamProfileLink entryId={entryId}>{teamName}</TeamProfileLink></h2>
              <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
                {isCurrentCaptainTurn
                  ? `第 ${currentRound ?? "-"} 轮，轮到你选择`
                  : currentTeamName
                    ? <>等待 <TeamProfileLink entryId={currentEntryId}>{currentTeamName}</TeamProfileLink> 选择</>
                    : "等待选秀状态更新"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="size-4 text-[var(--color-fg-dim)]" aria-hidden="true" />
              <DraftCountdown deadline={roundDeadline} isActive={isDraftActive} />
            </div>
          </div>

          {message && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                message.type === "success"
                  ? "border-[var(--color-ok-edge)] bg-[var(--color-ok-soft)] text-[var(--color-ok)]"
                  : "border-[var(--color-danger-edge)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
              }`}
              role="status"
            >
              {message.text}
            </div>
          )}
        </div>
      )}

      {/* Roster Summary (collapsible) */}
      {!isReadonly && (
        <div className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden md:sticky md:top-20">
          <button
            type="button"
            disabled={!interactive}
            onClick={() => setRosterOpen(!rosterOpen)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)] transition-colors"
          >
            {rosterOpen ? (
              <ChevronDown className="size-4 text-[var(--color-fg-dim)]" />
            ) : (
              <ChevronRight className="size-4 text-[var(--color-fg-dim)]" />
            )}
            我的阵容（{rosterMembers.length + 1} 人）
          </button>
          {(
            <div className={`border-t border-[var(--color-border)] px-4 py-3 space-y-3 ${rosterOpen ? "" : "hidden md:block"}`}>
              {/* Position occupation */}
              <div className="flex flex-wrap gap-2 text-xs text-[var(--color-fg-mid)]">
                {seasonPositions.map((pos) => {
                  const count = positionCounts[pos] ?? 0;
                  const full = !canPickPosition(count);
                  return (
                    <span
                      key={pos}
                      className={full ? "text-[var(--color-danger)]" : ""}
                    >
                      {positionLabel(pos)} {count}/2
                    </span>
                  );
                })}
              </div>
              {/* Members list */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-[var(--color-fg)]">
                  <PosChip pos={positionLabel(captainPosition)} small />
                  <span className="text-[var(--color-accent)]">队长</span>
                </div>
                {rosterMembers.map((member, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-fg)]">
                    <PlayerAvatar name={getPublicDisplayName(member)} avatarUrl={member.avatarUrl} size="sm" />
                    <PosChip pos={positionLabel(member.primaryPosition)} small />
                    <PlayerProfileLink userId={member.userId}>{getPublicDisplayName(member)}</PlayerProfileLink>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        {/* Auto-pick candidate hint */}
        {!isReadonly && autoPickCandidate && isCurrentCaptainTurn && (
          <div className="mb-4 rounded-sm border px-3 py-2 text-xs" style={{ borderColor: "var(--color-warn-edge)", background: "var(--color-warn-soft)", color: "var(--color-warn)" }}>
            <div className="flex items-center gap-2">
              <Zap className="size-3.5 shrink-0" aria-hidden="true" style={{ color: "var(--color-warn)" }} />
              <span>
                超时自动选人：<PlayerProfileLink userId={autoPickCandidate.userId}>{getPublicDisplayName(autoPickCandidate)}</PlayerProfileLink>（{positionLabel(autoPickCandidate.primaryPosition)}，{autoPickCandidate.peakRank}）
              </span>
              <HelpTooltip label="自动选人规则" content="依次比较历史最高段位、Peak Rating、当前段位和当前 Rating，优先补齐空位，每位置最多 2 人。" />
            </div>
          </div>
        )}

        {/* Search + filters */}
        <div className="mb-4 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-dim)]" aria-hidden="true" />
            <input
              type="text"
              disabled={!interactive}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索选手名..."
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel-hi)] py-1.5 pl-8 pr-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={filter === FILTER_ALL ? "default" : "secondary"}
              disabled={!interactive}
              onClick={() => setFilter(FILTER_ALL)}
            >
              全部 {players.length}
            </Button>
            {positionOptions.map((position) => {
              const count = grouped.get(position)?.length ?? 0;
              const teamCount = positionCounts[position] ?? 0;
              return (
                <Button
                  key={position}
                  type="button"
                  size="sm"
                  variant={filter === position ? "default" : "secondary"}
                  disabled={!interactive || count === 0}
                  onClick={() => setFilter(filter === position ? FILTER_ALL : position)}
                >
                  {positionLabel(position)} {teamCount}/2 · {count}
                </Button>
              );
            })}
          </div>
        </div>

        {sortedPlayers.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--color-fg-dim)]">
            当前筛选下没有可选选手
          </div>
        ) : (
          <div className="space-y-1">
            {sortedPlayers.map((player) => {
              const positionCount = positionCounts[player.primaryPosition] ?? 0;
              const positionOpen = canPickPosition(positionCount);
              const isPending = pendingRegistrationId === player.registrationId;
              const disabled = !canSubmit || !positionOpen || isPending;
              const displayedName = getPublicDisplayName(player);

              return (
                <div
                  key={player.registrationId}
                  className={`rounded-md border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2 transition-opacity ${
                    !positionOpen ? "opacity-40" : ""
                  }`}
                >
                  <div className="hidden md:flex items-center gap-3">
                    <PlayerAvatar name={displayedName} avatarUrl={player.avatarUrl} size="sm" />
                    {/* Rank badges: peak + current */}
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-fg)",
                          borderColor: "var(--color-border)",
                          background: "var(--color-panel)",
                        }}
                        title="历史最高段位"
                      >
                        {player.peakRank}
                      </span>
                      {player.currentRank && player.currentRank !== player.peakRank && (
                        <span
                          className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium opacity-70"
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-fg-mid)",
                            borderColor: "var(--color-border)",
                            background: "var(--color-panel)",
                          }}
                          title="当前赛季段位"
                        >
                          {player.currentRank}
                        </span>
                      )}
                    </div>

                    {/* Name (clickable) */}
                    <PlayerProfileLink
                      userId={player.userId}
                      className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                    >
                      {displayedName}
                    </PlayerProfileLink>

                    {/* Primary position */}
                    <PosChip pos={positionLabel(player.primaryPosition)} small />

                    {/* Secondary position */}
                    <span className="shrink-0 text-xs text-[var(--color-fg-dim)]">
                      副选 {positionLabel(player.secondaryPosition)}
                    </span>

                    {/* Rating: peak / current */}
                    <span
                      className="shrink-0 text-xs tabular-nums text-[var(--color-fg-mid)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                      title={`巅峰 ${player.peakRating.toFixed(0)} / 当前 ${player.currentRating.toFixed(0)}`}
                    >
                      {player.peakRating.toFixed(0)}{player.currentRating !== player.peakRating && (
                        <span className="opacity-60"> / {player.currentRating.toFixed(0)}</span>
                      )}
                    </span>

                    {/* Map preferences */}
                    <div className="min-w-0 flex-1">
                      <MapPreferenceChips preferences={player.mapPreferences} compact minLevel="playable" />
                    </div>

                    <Button size="sm" variant="ghost" disabled={!interactive} onClick={() => setInspectedId(current => current === player.registrationId ? null : player.registrationId)} aria-expanded={inspectedId === player.registrationId} aria-controls={`draft-detail-${player.registrationId} draft-inspector`}>{interactive ? "详情" : "准备中…"}</Button>

                    {/* Pick button */}
                    {!isReadonly && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={disabled}
                        aria-label={positionOpen ? `选入 ${displayedName}` : `${displayedName} 已满`}
                        onClick={() => void handlePick(player)}
                        className="shrink-0"
                      >
                        {isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : positionOpen ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : null}
                        {positionOpen ? "选入" : "已满"}
                      </Button>
                    )}
                  </div>

                  <div className="md:hidden space-y-1.5">
                    <div className="flex items-center gap-2">
                      <PlayerAvatar name={displayedName} avatarUrl={player.avatarUrl} size="sm" />
                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-fg)",
                            borderColor: "var(--color-border)",
                            background: "var(--color-panel)",
                          }}
                        >
                          {player.peakRank}
                        </span>
                        {player.currentRank && player.currentRank !== player.peakRank && (
                          <span
                            className="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium opacity-70"
                            style={{
                              fontFamily: "var(--font-mono)",
                              color: "var(--color-fg-mid)",
                              borderColor: "var(--color-border)",
                              background: "var(--color-panel)",
                            }}
                          >
                            {player.currentRank}
                          </span>
                        )}
                      </div>
                      <PlayerProfileLink
                        userId={player.userId}
                        className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                      >
                        {displayedName}
                      </PlayerProfileLink>
                      <PosChip pos={positionLabel(player.primaryPosition)} small />
                      <span className="text-xs text-[var(--color-fg-dim)]">
                        副选 {positionLabel(player.secondaryPosition)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="shrink-0 text-xs tabular-nums text-[var(--color-fg-mid)]"
                          style={{ fontFamily: "var(--font-mono)" }}
                          title={`巅峰 ${player.peakRating.toFixed(0)} / 当前 ${player.currentRating.toFixed(0)}`}
                        >
                          {player.peakRating.toFixed(0)}{player.currentRating !== player.peakRating && (
                            <span className="opacity-60"> / {player.currentRating.toFixed(0)}</span>
                          )}
                        </span>
                        <div className="min-w-0">
                          <MapPreferenceChips preferences={player.mapPreferences} compact minLevel="playable" />
                        </div>
                        <Button size="sm" variant="ghost" disabled={!interactive} onClick={() => setInspectedId(current => current === player.registrationId ? null : player.registrationId)} aria-expanded={inspectedId === player.registrationId} aria-controls={`draft-detail-${player.registrationId} draft-inspector`}>{interactive ? "详情" : "准备中…"}</Button>
                      </div>
                      {!isReadonly && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={disabled}
                          aria-label={positionOpen ? `选入 ${displayedName}` : `${displayedName} 已满`}
                          onClick={() => void handlePick(player)}
                          className="shrink-0"
                        >
                          {isPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : positionOpen ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : null}
                          {positionOpen ? "选入" : "已满"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {inspectedId === player.registrationId && <div id={`draft-detail-${player.registrationId}`} role="region" aria-label={`选手详情 · ${displayedName}`} className="mt-4 border-t border-[var(--color-border)] pt-4 xl:hidden"><DraftPlayerDetails player={player} canSelect={canSubmit && canPickPosition(positionCounts[player.primaryPosition] ?? 0)} onPick={isReadonly ? undefined : () => void handlePick(player)} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <aside id="draft-inspector" className="hidden min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5 md:col-start-2 xl:col-start-3 xl:row-start-2 xl:block xl:sticky xl:top-20" aria-label="选手详情">
        {inspected ? <DraftPlayerDetails player={inspected} canSelect={canSubmit && canPickPosition(positionCounts[inspected.primaryPosition] ?? 0)} onPick={isReadonly ? undefined : () => void handlePick(inspected)} /> : <><h2 className="font-semibold">选手详情</h2><p className="mt-3 text-sm leading-6 text-[var(--color-fg-mid)]">选择选手查看。</p></>}
      </aside>
    </div>
  );
}

function DraftPlayerDetails({ player, canSelect, onPick }: { player: CaptainDraftPlayer; canSelect: boolean; onPick?: () => void }) {
  return <><p className="text-xs text-[var(--color-fg-mid)]">选手详情</p><h2 className="mt-3 text-xl font-semibold"><PlayerProfileLink userId={player.userId}>{getPublicDisplayName(player)}</PlayerProfileLink></h2><p className="mt-2 text-sm text-[var(--color-fg-mid)]">{positionLabel(player.primaryPosition)} · 副选 {positionLabel(player.secondaryPosition)}</p><dl className="my-5 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-[var(--color-fg-mid)]">最高段位</dt><dd className="mt-1 font-mono">{player.peakRank}</dd></div><div><dt className="text-[var(--color-fg-mid)]">Peak Rating</dt><dd className="mt-1 font-mono">{player.peakRating}</dd></div></dl><p className="text-sm leading-6">{player.gameplayStyle || "暂无打法说明"}</p>{player.competitionHistory && <p className="mt-4 text-sm leading-6 text-[var(--color-fg-mid)]">{player.competitionHistory}</p>}{player.notes && <p className="mt-4 text-sm leading-6 text-[var(--color-fg-mid)]">{player.notes}</p>}{onPick && <Button className="mt-5" disabled={!canSelect} onClick={onPick}>选入本队</Button>}</>;
}
