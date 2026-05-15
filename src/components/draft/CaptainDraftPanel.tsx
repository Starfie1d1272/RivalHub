"use client";

import React from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Clock, Loader2 } from "lucide-react";
import { pickPlayer } from "@/actions/draft";
import { Button } from "@/components/ui/button";
import { DraftCountdown } from "./DraftCountdown";
import { canPickPosition } from "@/lib/draft/rules";
import { positionLabel } from "@/lib/validators/registration";
import { MapPreferenceChips } from "@/components/rivalhub/map-preference-chips";
import { PosChip } from "@/components/rivalhub/pos-chip";
import { getDisplayName } from "@/lib/utils/display-name";
import { sortByRank } from "@/lib/utils/rank";
import type { MapPreference } from "@/types/season";

const FILTER_ALL = "all";

export interface CaptainDraftPlayer {
  registrationId: string;
  userId: string;
  steamName: string;
  perfectName: string | null;
  displayName: string | null;
  email: string | null;
  primaryPosition: string;
  secondaryPosition: string;
  peakRank: string;
  peakRating: number;
  mapPreferences: MapPreference[];
}

interface CaptainDraftPanelProps {
  seasonId: string;
  teamId: string;
  teamName: string;
  currentTeamName: string | null;
  currentRound: number | null;
  roundDeadline: string | null;
  isDraftActive: boolean;
  isCurrentCaptainTurn: boolean;
  positionCounts: Record<string, number>;
  players: CaptainDraftPlayer[];
  seasonPositions: string[];
  /** Already picked members for roster summary */
  rosterMembers: { steamName: string; perfectName: string | null; displayName: string | null; primaryPosition: string }[];
  captainPosition: string;
}

export function CaptainDraftPanel({
  seasonId,
  teamId,
  teamName,
  currentTeamName,
  currentRound,
  roundDeadline,
  isDraftActive,
  isCurrentCaptainTurn,
  positionCounts,
  players,
  seasonPositions,
  rosterMembers,
  captainPosition,
}: CaptainDraftPanelProps) {
  const router = useRouter();
  const [filter, setFilter] = useState(FILTER_ALL);
  const [pendingRegistrationId, setPendingRegistrationId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);

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
    const filtered =
      filter === FILTER_ALL
        ? players
        : players.filter((player) => player.primaryPosition === filter);
    return sortByRank(filtered);
  }, [players, filter]);

  const canSubmit = isDraftActive && isCurrentCaptainTurn && pendingRegistrationId === null;

  async function handlePick(player: CaptainDraftPlayer) {
    if (!canSubmit || !canPickPosition(positionCounts[player.primaryPosition] ?? 0)) return;

    setPendingRegistrationId(player.registrationId);
    setMessage(null);

    const result = await pickPlayer({
      seasonId,
      teamId,
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
        : `${getDisplayName(player)} 已加入队伍`,
    });
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-fg)]">{teamName}</h2>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
              {isCurrentCaptainTurn
                ? `第 ${currentRound ?? "-"} 轮，轮到你选择`
                : currentTeamName
                  ? `等待 ${currentTeamName} 选择`
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
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
            role="status"
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Roster Summary (collapsible) */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
        <button
          type="button"
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
        {rosterOpen && (
          <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-3">
            {/* Position occupation */}
            <div className="flex flex-wrap gap-2 text-xs text-[var(--color-fg-mid)]">
              {seasonPositions.map((pos) => {
                const count = positionCounts[pos] ?? 0;
                const full = !canPickPosition(count);
                return (
                  <span
                    key={pos}
                    className={full ? "text-red-400" : ""}
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
                  <PosChip pos={positionLabel(member.primaryPosition)} small />
                  <span>{getDisplayName(member)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={filter === FILTER_ALL ? "default" : "secondary"}
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
                disabled={count === 0}
                onClick={() => setFilter(filter === position ? FILTER_ALL : position)}
              >
                {positionLabel(position)} {teamCount}/2 · {count}
              </Button>
            );
          })}
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
              const displayedName = getDisplayName(player);

              return (
                <div
                  key={player.registrationId}
                  className={`rounded-md border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2 transition-opacity ${
                    !positionOpen ? "opacity-40" : ""
                  }`}
                >
                  <div className="hidden md:flex items-center gap-3">
                    {/* Rank badge */}
                    <span
                      className="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-fg)",
                        borderColor: "var(--color-border)",
                        background: "var(--color-panel)",
                      }}
                    >
                      {player.peakRank}
                    </span>

                    {/* Name (clickable) */}
                    <Link
                      href={`/players/${player.userId}`}
                      className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                    >
                      {displayedName}
                    </Link>

                    {/* Primary position */}
                    <PosChip pos={positionLabel(player.primaryPosition)} small />

                    {/* Secondary position */}
                    <span className="shrink-0 text-xs text-[var(--color-fg-dim)]">
                      副选 {positionLabel(player.secondaryPosition)}
                    </span>

                    {/* Rating */}
                    <span
                      className="shrink-0 text-xs tabular-nums text-[var(--color-fg-mid)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {player.peakRating.toFixed(2)}
                    </span>

                    {/* Map preferences */}
                    <div className="min-w-0 flex-1">
                      <MapPreferenceChips preferences={player.mapPreferences} compact minLevel="playable" />
                    </div>

                    {/* Pick button */}
                    <Button
                      type="button"
                      size="sm"
                      disabled={disabled}
                      aria-label={positionOpen ? `选择 ${displayedName}` : `${displayedName} 已满`}
                      onClick={() => void handlePick(player)}
                      className="shrink-0"
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : positionOpen ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : null}
                      {positionOpen ? "选择" : "已满"}
                    </Button>
                  </div>

                  <div className="md:hidden space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-fg)",
                          borderColor: "var(--color-border)",
                          background: "var(--color-panel)",
                        }}
                      >
                        {player.peakRank}
                      </span>
                      <Link
                        href={`/players/${player.userId}`}
                        className="min-w-0 truncate text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                      >
                        {displayedName}
                      </Link>
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
                        >
                          {player.peakRating.toFixed(2)}
                        </span>
                        <div className="min-w-0">
                          <MapPreferenceChips preferences={player.mapPreferences} compact minLevel="playable" />
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={disabled}
                        aria-label={positionOpen ? `选择 ${displayedName}` : `${displayedName} 已满`}
                        onClick={() => void handlePick(player)}
                        className="shrink-0"
                      >
                        {isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : positionOpen ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : null}
                        {positionOpen ? "选择" : "已满"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
