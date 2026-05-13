"use client";

import React from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Loader2 } from "lucide-react";
import { pickPlayer } from "@/actions/draft";
import { Button } from "@/components/ui/button";
import { DraftCountdown } from "./DraftCountdown";
import { canPickPosition } from "@/lib/draft/rules";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { MapPreferenceChips } from "@/components/rivalhub/map-preference-chips";
import type { MapPreference } from "@/types/season";

export interface CaptainDraftPlayer {
  registrationId: string;
  steamName: string;
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
}

function positionLabel(position: string): string {
  return POSITION_LABELS[position as keyof typeof POSITION_LABELS]?.en ?? position;
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
}: CaptainDraftPanelProps) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [pendingRegistrationId, setPendingRegistrationId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const visiblePlayers =
    filter === "all"
      ? players
      : players.filter((player) => player.primaryPosition === filter);

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
      text: result.data.completed ? "选秀已完成" : `${player.steamName} 已加入队伍`,
    });
    router.refresh();
  }

  return (
    <div className="space-y-5">
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

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={filter === "all" ? "default" : "secondary"}
            onClick={() => setFilter("all")}
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
                onClick={() => setFilter(filter === position ? "all" : position)}
              >
                {positionLabel(position)} {teamCount}/2 · {count}
              </Button>
            );
          })}
        </div>

        {visiblePlayers.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--color-fg-dim)]">
            当前筛选下没有可选选手
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {visiblePlayers.map((player) => {
              const positionCount = positionCounts[player.primaryPosition] ?? 0;
              const positionOpen = canPickPosition(positionCount);
              const isPending = pendingRegistrationId === player.registrationId;
              const disabled = !canSubmit || !positionOpen || isPending;
              const buttonLabel = positionOpen ? `选择 ${player.steamName}` : `${player.steamName} 已达上限`;

              return (
                <div
                  key={player.registrationId}
                  className="flex min-h-20 items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                      {player.steamName}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-fg-dim)]">
                      <span>{positionLabel(player.primaryPosition)}</span>
                      <span>{player.peakRank} {player.peakRating.toFixed(2)}</span>
                      <span>副选 {positionLabel(player.secondaryPosition)}</span>
                    </div>
                    <div className="mt-2">
                      <MapPreferenceChips preferences={player.mapPreferences} compact minLevel="playable" />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    aria-label={buttonLabel}
                    onClick={() => void handlePick(player)}
                  >
                    {isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : positionOpen ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : null}
                    {positionOpen ? "选择" : "已达上限"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
