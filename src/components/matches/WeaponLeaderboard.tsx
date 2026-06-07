"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { displayWeaponName } from "@cs2dak/presentation";
import type { PlayerWeaponStats, WeaponKillRow } from "@/actions/season-demo-stats";

interface WeaponLeaderboardProps {
  players: PlayerWeaponStats[];
  seasonSlug: string;
}

function PlayerName({
  userId,
  name,
}: {
  userId: string | null;
  name: string;
}) {
  if (!userId) return <>{name}</>;
  return (
    <Link
      href={`/players/${userId}` as any}
      className="text-[var(--color-accent)] hover:underline font-medium"
    >
      {name}
    </Link>
  );
}

function WeaponBadge({ weapon, kills, hsPercent }: WeaponKillRow) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-[var(--color-bg-secondary)] mr-1.5 mb-1.5">
      <span className="font-medium">{displayWeaponName(weapon)}</span>
      <span className="text-[var(--color-fg-mid)]">{kills}</span>
      {hsPercent != null && (
        <span className="text-[var(--color-fg-dim)]">{hsPercent}%HS</span>
      )}
    </span>
  );
}

function overallHsPercent(p: PlayerWeaponStats): number | null {
  if (p.totalKills <= 0) return null;
  const hs = p.weapons.reduce((s, w) => s + w.headshots, 0);
  return Math.round((hs / p.totalKills) * 100);
}

/** AWP 狙击榜：谁在赛季里靠 AWP 拿分（位置/角色信号） */
function AwpLeaderboard({ players }: { players: PlayerWeaponStats[] }) {
  const snipers = useMemo(
    () =>
      players
        .filter((p) => p.awpKills > 0)
        .sort((a, b) => b.awpKills - a.awpKills)
        .slice(0, 12),
    [players],
  );

  if (snipers.length === 0) return null;

  return (
    <Panel label="AWP 狙击榜">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-dim)] text-xs uppercase tracking-wider">
              <th className="text-left px-2.5 py-2">#</th>
              <th className="text-left px-2.5 py-2">选手</th>
              <th className="text-right px-2.5 py-2">AWP 击杀</th>
              <th className="text-right px-2.5 py-2">AWP 占比</th>
            </tr>
          </thead>
          <tbody>
            {snipers.map((p, i) => {
              const share = p.totalKills > 0 ? Math.round((p.awpKills / p.totalKills) * 100) : 0;
              return (
                <tr
                  key={p.userId ?? `awp${i}`}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-2.5 py-2.5 text-xs text-[var(--color-fg-dim)]">{i + 1}</td>
                  <td className="px-2.5 py-2.5">
                    <PlayerName userId={p.userId} name={p.perfectName} />
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-mono">{p.awpKills}</td>
                  <td className="px-2.5 py-2.5 text-right font-mono text-[var(--color-fg-mid)]">
                    {share}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** 武器使用画像：每名选手的总击杀、爆头率与主武器分布 */
function WeaponUsageTable({ players }: { players: PlayerWeaponStats[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const sorted = useMemo(
    () => [...players].sort((a, b) => b.totalKills - a.totalKills).slice(0, 20),
    [players],
  );

  const toggleExpand = (idx: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  return (
    <Panel label="武器使用画像">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-dim)] text-xs uppercase tracking-wider">
              <th className="text-left px-2.5 py-2">#</th>
              <th className="text-left px-2.5 py-2">选手</th>
              <th className="text-right px-2.5 py-2">总击杀</th>
              <th className="text-right px-2.5 py-2">爆头率</th>
              <th className="text-left px-2.5 py-2">主武器分布</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const isExpanded = expanded.has(i);
              const hs = overallHsPercent(p);
              const ranked = [...p.weapons].sort((a, b) => b.kills - a.kills);
              return (
                <tr
                  key={p.userId ?? `p${i}`}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-2.5 py-2.5 text-xs text-[var(--color-fg-dim)]">{i + 1}</td>
                  <td className="px-2.5 py-2.5">
                    <PlayerName userId={p.userId} name={p.perfectName} />
                  </td>
                  <td className="px-2.5 py-2.5 text-right font-mono">{p.totalKills}</td>
                  <td className="px-2.5 py-2.5 text-right font-mono">
                    {hs != null ? `${hs}%` : "—"}
                  </td>
                  <td className="px-2.5 py-2.5">
                    <div className="flex flex-wrap gap-0">
                      {ranked.slice(0, 3).map((w) => (
                        <WeaponBadge key={w.weapon} {...w} />
                      ))}
                      {ranked.length > 3 && (
                        <button
                          onClick={() => toggleExpand(i)}
                          className="inline-flex items-center px-2 py-1 text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]"
                        >
                          {isExpanded ? "收起" : `+${ranked.length - 3}`}
                        </button>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="flex flex-wrap gap-0 mt-2 pt-2 border-t border-[var(--color-border)]">
                        {ranked.slice(3).map((w) => (
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
    </Panel>
  );
}

export function WeaponLeaderboard({ players }: WeaponLeaderboardProps) {
  if (players.length === 0) return null;
  return (
    <div className="space-y-6">
      <AwpLeaderboard players={players} />
      <WeaponUsageTable players={players} />
    </div>
  );
}
