import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { DemoPlayerStatRow } from "@/actions/demo-detail";

interface DemoPlayerStatsTableProps {
  players: DemoPlayerStatRow[];
  teamAName: string;
  teamBName: string;
  seasonSlug: string;
  /** steamId64 → 游戏内昵称 */
  playerNameMap: Record<string, string>;
}

const TEAM_COLORS = {
  A: { border: "var(--color-accent)", bg: "color-mix(in srgb, var(--color-accent) 4%, transparent)" },
  B: { border: "var(--color-accent-b)", bg: "color-mix(in srgb, var(--color-accent-b) 4%, transparent)" },
};

type SectionField =
  | { key: string; label: string; fmt?: (v: number | null, row: DemoPlayerStatRow) => string }
  | { key: string; label: string; pairKey: string };

interface Section {
  label: string;
  fields: SectionField[];
}

const SECTIONS: Section[] = [
  {
    label: "Core",
    fields: [
      { key: "kills", label: "K" },
      { key: "deaths", label: "D" },
      { key: "assists", label: "A" },
      { key: "adr", label: "ADR", fmt: (v) => (v != null ? v.toFixed(1) : "—") },
      {
        key: "headshotCount",
        label: "HS%",
        fmt: (_v, row) => {
          const r = row as unknown as Record<string, unknown>;
          const hs = r.headshotCount;
          const k = r.kills;
          if (typeof hs === "number" && typeof k === "number" && k > 0)
            return `${((hs / k) * 100).toFixed(0)}%`;
          return "—";
        },
      },
      { key: "kast", label: "KAST%", fmt: (v) => (v != null ? `${v.toFixed(1)}%` : "—") },
    ],
  },
  {
    label: "Utility",
    fields: [
      { key: "utilityDamage", label: "Util Dmg" },
      { key: "averageUtilityDamagePerRound", label: "Util/R", fmt: (v) => (v != null ? v.toFixed(1) : "—") },
      { key: "bombPlantedCount", label: "Plant" },
      { key: "bombDefusedCount", label: "Defuse" },
    ],
  },
  {
    label: "Entry / Trade",
    fields: [
      { key: "firstKillCount", label: "FK" },
      { key: "firstDeathCount", label: "FD" },
      { key: "tradeKillCount", label: "Trade K" },
      { key: "tradeDeathCount", label: "Trade D" },
    ],
  },
  {
    label: "Multi-Kills",
    fields: [
      { key: "oneKillCount", label: "1K" },
      { key: "twoKillCount", label: "2K" },
      { key: "threeKillCount", label: "3K" },
      { key: "fourKillCount", label: "4K" },
      { key: "fiveKillCount", label: "5K" },
    ],
  },
  {
    label: "Clutch (Won/Total)",
    fields: [
      { key: "vsOneWonCount", label: "1v1W", pairKey: "vsOneCount" },
      { key: "vsTwoWonCount", label: "1v2W", pairKey: "vsTwoCount" },
      { key: "vsThreeWonCount", label: "1v3W", pairKey: "vsThreeCount" },
      { key: "vsFourWonCount", label: "1v4W", pairKey: "vsFourCount" },
      { key: "vsFiveWonCount", label: "1v5W", pairKey: "vsFiveCount" },
    ],
  },
  {
    label: "Highlight Kills",
    fields: [
      { key: "wallbangKillCount", label: "Wallbang" },
      { key: "noScopeKillCount", label: "NoScope" },
      { key: "collateralKillCount", label: "Collateral" },
    ],
  },
];

function getVal(row: DemoPlayerStatRow, key: string): number | null {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  return null;
}

function TeamTable({
  players,
  label,
  color,
  seasonSlug,
  playerNameMap,
}: {
  players: DemoPlayerStatRow[];
  label: string;
  color: { border: string; bg: string };
  seasonSlug: string;
  playerNameMap: Record<string, string>;
}) {
  if (players.length === 0) return null;
  return (
    <div className="flex-1 min-w-0 rounded-md overflow-hidden" style={{ backgroundColor: color.bg }}>
      <div
        className="px-3 py-2 text-[11px] font-bold tracking-widest uppercase"
        style={{ borderLeft: `3px solid ${color.border}` }}
      >
        {label}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]" style={{ minWidth: 560 }}>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left text-[10px] text-[var(--color-fg-dim)] font-medium py-1 pl-3 pr-1 whitespace-nowrap">
                Player
              </th>
              {SECTIONS.flatMap((s) =>
                s.fields.map((f) => (
                  <th
                    key={f.key}
                    className="text-center text-[10px] text-[var(--color-fg-dim)] font-medium px-1.5 py-1 whitespace-nowrap"
                    title={f.label}
                  >
                    {f.label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr
                key={p.steamId64}
                className={cn(
                  "border-b border-[var(--color-border)] last:border-0",
                  i % 2 === 0 && "bg-[var(--color-bg-subtle)]",
                )}
              >
                <td className="py-1.5 pl-3 pr-1 whitespace-nowrap">
                  {p.userId ? (
                    <Link
                      href={`/${seasonSlug}/players/${p.userId}` as any}
                      className="text-xs font-medium hover:text-[var(--color-accent)] transition-colors"
                    >
                      {playerNameMap[p.steamId64] ?? p.steamId64}
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-fg-dim)]">
                      {playerNameMap[p.steamId64] ?? p.steamId64}
                    </span>
                  )}
                </td>
                {SECTIONS.flatMap((s) =>
                  s.fields.map((f) => {
                    const raw = getVal(p, f.key);
                    if ("pairKey" in f) {
                      const total = getVal(p, f.pairKey);
                      const label = total != null && total > 0
                        ? `${raw ?? 0}/${total}`
                        : "—";
                      return (
                        <td
                          key={f.key}
                          className="text-center px-1.5 py-1 tabular-nums text-xs text-[var(--color-fg)]"
                        >
                          {label}
                        </td>
                      );
                    }
                    const val = f.fmt ? f.fmt(raw, p) : raw ?? "—";
                    return (
                      <td
                        key={f.key}
                        className="text-center px-1.5 py-1 tabular-nums text-xs text-[var(--color-fg)]"
                      >
                        {String(val)}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Demo detail player-stats table.
 * Split by teamKey into two columns matching existing OCR two-column style.
 */
export function DemoPlayerStatsTable({
  players,
  teamAName,
  teamBName,
  seasonSlug,
  playerNameMap,
}: DemoPlayerStatsTableProps) {
  const teamA = players.filter((p) => p.teamKey === "teamA");
  const teamB = players.filter((p) => p.teamKey === "teamB");

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-dim)] py-2">No demo player data</p>
    );
  }

  return (
    <div className="flex gap-4">
      <TeamTable players={teamA} label={teamAName} color={TEAM_COLORS.A} seasonSlug={seasonSlug} playerNameMap={playerNameMap} />
      <div className="w-px bg-[var(--color-border)] self-stretch" />
      <TeamTable players={teamB} label={teamBName} color={TEAM_COLORS.B} seasonSlug={seasonSlug} playerNameMap={playerNameMap} />
    </div>
  );
}
