import React from "react";
import { cn } from "@/lib/utils/cn";
import type { DemoPlayerStatRow } from "@/actions/demo-detail";

interface DemoPlayerStatsTableProps {
  players: DemoPlayerStatRow[];
  teamAName: string;
  teamBName: string;
}

const SECTIONS = [
  {
    label: "基础数据",
    fields: [
      { key: "kills", label: "K" },
      { key: "deaths", label: "D" },
      { key: "assists", label: "A" },
      { key: "adr", label: "ADR", fmt: (v: number | null) => (v != null ? v.toFixed(1) : "—") },
      { key: "kast", label: "KAST", fmt: (v: number | null) => (v != null ? `${(v * 100).toFixed(0)}%` : "—") },
    ],
  },
  {
    label: "Utility",
    fields: [
      { key: "utilityDamage", label: "Util Dmg" },
      { key: "averageUtilityDamagePerRound", label: "Util/R", fmt: (v: number | null) => (v != null ? v.toFixed(1) : "—") },
      { key: "bombPlantedCount", label: "Plant" },
      { key: "bombDefusedCount", label: "Defuse" },
    ],
  },
  {
    label: "首杀 / Trade",
    fields: [
      { key: "firstKillCount", label: "FK" },
      { key: "firstDeathCount", label: "FD" },
      { key: "tradeKillCount", label: "Trade K" },
      { key: "tradeDeathCount", label: "Trade D" },
    ],
  },
  {
    label: "多杀细分",
    fields: [
      { key: "oneKillCount", label: "1K" },
      { key: "twoKillCount", label: "2K" },
      { key: "threeKillCount", label: "3K" },
      { key: "fourKillCount", label: "4K" },
      { key: "fiveKillCount", label: "5K" },
    ],
  },
  {
    label: "残局 (尝试/胜)",
    fields: [
      { key: "vsOneWonCount", label: "1v1W", pairKey: "vsOneCount", pairLabel: "1v1" },
      { key: "vsTwoWonCount", label: "1v2W", pairKey: "vsTwoCount", pairLabel: "1v2" },
      { key: "vsThreeWonCount", label: "1v3W", pairKey: "vsThreeCount", pairLabel: "1v3" },
      { key: "vsFourWonCount", label: "1v4W", pairKey: "vsFourCount", pairLabel: "1v4" },
      { key: "vsFiveWonCount", label: "1v5W", pairKey: "vsFiveCount", pairLabel: "1v5" },
    ],
  },
  {
    label: "高光击杀",
    fields: [
      { key: "wallbangKillCount", label: "Wallbang" },
      { key: "noScopeKillCount", label: "NoScope" },
      { key: "collateralKillCount", label: "Collateral" },
    ],
  },
] as const;

/** 从 DemoPlayerStatRow 取值的类型安全 getter */
function getVal(row: DemoPlayerStatRow, key: string): number | null {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  return null;
}

/** 渲染单队表格列 */
function TeamTable({
  players,
  label,
}: {
  players: DemoPlayerStatRow[];
  label: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <h4 className="text-xs font-semibold text-[var(--color-fg)] mb-2 px-1">
        {label}
      </h4>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="text-left py-1 pr-2 text-[var(--color-fg-dim)] font-medium">
              选手
            </th>
            {SECTIONS.flatMap((s) =>
              s.fields.map((f) => (
                <th
                  key={f.key}
                  className="text-center py-1 px-1 text-[var(--color-fg-dim)] font-medium"
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
              <td className="py-1.5 pr-2 whitespace-nowrap text-[var(--color-fg)]">
                {p.userId ? (
                  <span className="font-medium">{p.steamId64}</span>
                ) : (
                  <span className="text-[var(--color-fg-dim)]">{p.steamId64}</span>
                )}
              </td>
              {SECTIONS.flatMap((s) =>
                s.fields.map((f) => {
                  const raw = getVal(p, f.key);
                  if ("pairKey" in f && f.pairKey) {
                    const total = getVal(p, f.pairKey as string);
                    const label = total != null && total > 0
                      ? `${raw ?? 0}/${total}`
                      : "—";
                    return (
                      <td
                        key={f.key}
                        className="text-center py-1 px-1 text-[var(--color-fg)] tabular-nums"
                      >
                        {label}
                      </td>
                    );
                  }
                  const val = "fmt" in f && f.fmt ? f.fmt(raw) : raw ?? "—";
                  return (
                    <td
                      key={f.key}
                      className="text-center py-1 px-1 text-[var(--color-fg)] tabular-nums"
                    >
                      {val}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Demo 明细 player-stats 展示表。
 * 纯展示组件，接收 Task 2 的 playerStats 数据。
 * 按 teamKey 分两栏对齐现有 OCR 双栏风格。
 */
export function DemoPlayerStatsTable({
  players,
  teamAName,
  teamBName,
}: DemoPlayerStatsTableProps) {
  const teamA = players.filter((p) => p.teamKey === "teamA");
  const teamB = players.filter((p) => p.teamKey === "teamB");

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无 Demo 玩家数据</p>
    );
  }

  return (
    <section className="space-y-2">
      {/* 列标签头（分栏） */}
      <div className="flex gap-4">
        <TeamTable players={teamA} label={teamAName} />
        <div className="w-px bg-[var(--color-border)] self-stretch" />
        <TeamTable players={teamB} label={teamBName} />
      </div>
    </section>
  );
}
