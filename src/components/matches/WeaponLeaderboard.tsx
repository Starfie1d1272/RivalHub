"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import type { PlayerWeaponStats, WeaponKillRow } from "@/actions/season-demo-stats";

interface WeaponLeaderboardProps {
  players: PlayerWeaponStats[];
  seasonSlug: string;
}

type SortKey = "awpKills" | "totalKills" | "hsPercent";

const WEAPON_DISPLAY: Record<string, string> = {
  ak47: "AK-47",    m4a4: "M4A4",       m4a1: "M4A1-S",
  awp: "AWP",        m4a1_silencer: "M4A1", deserteagle: "Deagle",
  usp: "USP-S",      glock: "Glock-18",
  deagle: "Desert Eagle",
  famas: "FAMAS",    galil: "Galil AR",
  mp9: "MP9",        mp7: "MP7",
  p250: "P250",      fiveseven: "Five-SeveN",
  tec9: "Tec-9",     cz75: "CZ75-Auto",
  ssg08: "SSG 08",   scar20: "SCAR-20",  g3sg1: "G3SG1",
  mac10: "MAC-10",   ump45: "UMP-45",
  p90: "P90",        bizon: "PP-Bizon",
  nova: "Nova",      xm1014: "XM1014",   mag7: "MAG-7",
  m249: "M249",      negev: "Negev",
  aug: "AUG",        sg556: "SG 553",
  elite: "Dual Berettas",
  knife: "刀",         taser: "电击枪",
  hegrenade: "HE 手雷",
  molotov: "燃烧弹",    incgrenade: "燃烧弹",
};

function weaponLabel(weapon: string): string {
  return WEAPON_DISPLAY[weapon.toLowerCase()] ?? weapon;
}

function WeaponBadge({ weapon, kills, headshots, hsPercent }: WeaponKillRow) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-[var(--color-bg-secondary)] mr-1.5 mb-1.5">
      <span className="font-medium">{weaponLabel(weapon)}</span>
      <span className="text-[var(--color-fg-mid)]">{kills}</span>
      {hsPercent != null && (
        <span className="text-[var(--color-fg-dim)]">
          {hsPercent}%HS
        </span>
      )}
    </span>
  );
}

export function WeaponLeaderboard({ players, seasonSlug }: WeaponLeaderboardProps) {
  const [sortBy, setSortBy] = useState<SortKey>("awpKills");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function getSortValue(p: PlayerWeaponStats): number {
    if (sortBy === "hsPercent") {
      const total = p.weapons.reduce((s, w) => s + w.headshots, 0);
      return p.totalKills > 0 ? total / p.totalKills : 0;
    }
    return p[sortBy];
  }
  const sorted = [...players].sort((a, b) => getSortValue(b) - getSortValue(a));

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <Panel label="武器 / AWP 击杀榜">
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {(["awpKills", "totalKills", "hsPercent"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                sortBy === key
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
              }`}
            >
              {key === "awpKills" ? "AWP击杀" : key === "totalKills" ? "总击杀" : "爆头率"}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-dim)] text-xs uppercase tracking-wider">
                <th className="text-left px-2.5 py-2">#</th>
                <th className="text-left px-2.5 py-2">选手</th>
                <th className="text-right px-2.5 py-2">AWP 击杀</th>
                <th className="text-right px-2.5 py-2">总击杀</th>
                <th className="text-right px-2.5 py-2">爆头率</th>
                <th className="text-left px-2.5 py-2">武器分布</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 20).map((p, i) => {
                const isExpanded = expanded.has(i);
                return (
                  <tr key={p.userId ?? `p${i}`} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-2.5 py-2.5 text-xs text-[var(--color-fg-dim)]">{i + 1}</td>
                    <td className="px-2.5 py-2.5">
                      {p.userId ? (
                        <Link
                          href={`/players/${p.userId}` as any}
                          className="text-[var(--color-accent)] hover:underline font-medium"
                        >
                          {p.perfectName}
                        </Link>
                      ) : (
                        p.perfectName
                      )}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-mono">{p.awpKills}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono">{p.totalKills}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono">
                      {p.weapons.length > 0 && p.totalKills > 0
                        ? `${Math.round((p.weapons.reduce((s, w) => s + w.headshots, 0) / p.totalKills) * 100)}%`
                        : "—"}
                    </td>
                    <td className="px-2.5 py-2.5">
                      <div className="flex flex-wrap gap-0">
                        {/* 显示 top-3 武器 */}
                        {p.weapons
                          .sort((a, b) => b.kills - a.kills)
                          .slice(0, 3)
                          .map((w) => (
                            <WeaponBadge key={w.weapon} {...w} />
                          ))}
                        {p.weapons.length > 3 && (
                          <button
                            onClick={() => toggleExpand(i)}
                            className="inline-flex items-center px-2 py-1 text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]"
                          >
                            +{p.weapons.length - 3}
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="flex flex-wrap gap-0 mt-2 pt-2 border-t border-[var(--color-border)]">
                          {p.weapons
                            .sort((a, b) => b.kills - a.kills)
                            .slice(3)
                            .map((w) => (
                              <WeaponBadge key={w.weapon} {...w} />
                            ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
