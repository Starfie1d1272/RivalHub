import React from "react";
import Link from "next/link";
import { Panel, PosChip } from "@/components/rivalhub";
import { positionLabel } from "@/lib/validators/registration";

export interface PlayerDirectoryData {
  userId: string;
  registrationId: string;
  displayName: string;
  primaryPosition: string;
  secondaryPosition: string | null;
  peakRank: string;
  peakRating: number;
  currentRank: string;
  currentRating: number;
  teamName: string | null;
  stats: {
    maps: number;
    avgRating: number;
    avgAdr: number;
    avgKd: number | null;
  } | null;
}

function DirectoryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-[58px]">
      <p className="text-[10px] uppercase text-[var(--color-fg-dim)]" style={{ fontFamily: "var(--font-mono)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold text-[var(--color-fg)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
    </div>
  );
}

export function PlayerDirectoryRow({ player }: { player: PlayerDirectoryData }) {
  return (
    <Panel hoverable pad={12}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/players/${player.userId}`}
              className="truncate text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors sm:text-base"
            >
              {player.displayName}
            </Link>
            <PosChip pos={positionLabel(player.primaryPosition)} />
            {player.secondaryPosition && (
              <span className="text-[11px] text-[var(--color-fg-dim)]">
                Secondary {positionLabel(player.secondaryPosition)}
              </span>
            )}
            <span className="text-xs text-[var(--color-fg-mid)]">
              {player.teamName ?? "Awaiting team assignment"}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <DirectoryMetric label="Peak Rank" value={player.peakRank} />
            <DirectoryMetric label="Peak RT" value={player.peakRating.toFixed(2)} />
            <DirectoryMetric label="Current Rank" value={player.currentRank} />
            <DirectoryMetric label="Current RT" value={player.currentRating.toFixed(2)} />
          </div>
        </div>

        {player.stats ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-2 lg:justify-end lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <DirectoryMetric label="Maps" value={player.stats.maps} />
            <DirectoryMetric label="Rating" value={player.stats.avgRating.toFixed(2)} />
            <DirectoryMetric label="ADR" value={player.stats.avgAdr.toFixed(1)} />
            <DirectoryMetric label="K/D" value={player.stats.avgKd != null ? player.stats.avgKd.toFixed(2) : "—"} />
          </div>
        ) : (
          <div className="border-t border-[var(--color-border)] pt-2 text-xs uppercase text-[var(--color-fg-dim)] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 lg:text-right" style={{ fontFamily: "var(--font-mono)" }}>
            No verified stats
          </div>
        )}
      </div>
    </Panel>
  );
}
