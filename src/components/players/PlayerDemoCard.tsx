import React from "react";
import { Panel } from "@/components/rivalhub";
import { displayWeaponName } from "@cs2dak/core";
import type { PlayerDemoAggregate } from "@/lib/demo/player-demo-stats";
import type { PlayerWeaponStats } from "@/actions/season-demo-stats";

interface PlayerDemoCardProps {
  seasonName: string;
  data: PlayerDemoAggregate;
  /** 赛季武器画像（可选，由 getSeasonWeaponStats 按 userId 过滤） */
  weapon?: PlayerWeaponStats;
}

function Tile({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="bg-[var(--color-bg-subtle)] rounded-lg p-3 text-center">
      <div className="text-lg font-bold" style={{ color: color ?? "var(--color-fg)" }}>
        {value}
      </div>
      <div className="text-[10px] text-[var(--color-fg-dim)] mt-0.5">{label}</div>
      {hint && <div className="text-[10px] text-[var(--color-fg-muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function clutchRow(label: string, c: { count: number; won: number }) {
  if (c.count === 0) return null;
  return (
    <div key={label} className="flex items-center justify-between text-xs py-1">
      <span className="text-[var(--color-fg-mid)]">{label}</span>
      <span className="font-mono">
        <span className="text-[var(--color-success)]">{c.won}</span>
        <span className="text-[var(--color-fg-dim)]"> / {c.count}</span>
        <span className="text-[var(--color-fg-muted)] ml-2">
          {c.count > 0 ? `${Math.round((c.won / c.count) * 100)}%` : "—"}
        </span>
      </span>
    </div>
  );
}

/**
 * 选手赛季 demo 进阶数据卡片。
 * 展示 KAST / ADR / Entry / 残局 / 道具 等 demo 来源聚合指标。
 */
export function PlayerDemoCard({ seasonName, data, weapon }: PlayerDemoCardProps) {
  const clutchRows = [
    clutchRow("1v1", data.vsOne),
    clutchRow("1v2", data.vsTwo),
    clutchRow("1v3", data.vsThree),
    clutchRow("1v4", data.vsFour),
    clutchRow("1v5", data.vsFive),
  ].filter(Boolean);

  // 多杀分布
  const mk = data.multiKills;
  const hasMultiKills = mk.two > 0 || mk.three > 0 || mk.four > 0 || mk.five > 0;

  // 高光
  const hl = data.highlights;
  const hasHighlights = hl.wallbang > 0 || hl.noScope > 0 || hl.collateral > 0;

  // 武器画像
  const topWeapons = weapon?.weapons
    ? [...weapon.weapons].sort((a, b) => b.kills - a.kills).slice(0, 5)
    : [];
  const hasAwp = (weapon?.awpKills ?? 0) > 0;

  return (
    <Panel pad={16}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-[var(--color-fg)]">{seasonName}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-panel-hi)] text-[var(--color-fg-dim)]">
          Demo · {data.totalRounds} 回合
        </span>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="KAST" value={`${data.kast.toFixed(1)}%`} color="var(--color-accent)" />
        <Tile label="ADR" value={data.adr.toFixed(1)} />
        <Tile
          label="Entry 成功率"
          value={pct(data.entrySuccessRate)}
          hint={`${data.firstKillCount} 首杀 / ${data.firstDeathCount} 首死`}
          color="var(--color-success)"
        />
        <Tile
          label="残局胜率"
          value={pct(data.clutchWinRate)}
          hint={`${data.clutchWins} / ${data.clutchAttempts}`}
          color="var(--color-warn)"
        />
      </div>

      {/* 次级指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        <Tile label="首杀 /100r" value={(data.firstKillRate * 100).toFixed(1)} />
        <Tile label="多杀 /100r" value={(data.multiKillRate * 100).toFixed(1)} />
        <Tile label="换命 /100r" value={(data.tradeKillRate * 100).toFixed(1)} />
        <Tile label="道具伤害 /回合" value={data.utilityDamagePerRound.toFixed(1)} />
      </div>

      {/* 武器分析 */}
      {topWeapons.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-[var(--color-fg-mid)] mb-2">
            武器使用
            {hasAwp && (
              <span className="ml-2 text-[var(--color-warn)]">
                AWP {weapon!.awpKills} 杀 ({(weapon!.totalKills > 0 ? Math.round((weapon!.awpKills / weapon!.totalKills) * 100) : 0)}%)
              </span>
            )}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {topWeapons.map((w) => (
              <span
                key={w.weapon}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)]"
              >
                <span className="font-medium">{displayWeaponName(w.weapon)}</span>
                <span className="text-[var(--color-fg-mid)]">{w.kills}</span>
                {w.hsPercent != null && (
                  <span className="text-[var(--color-fg-dim)]">{w.hsPercent}%HS</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 多杀分布 + 高光 */}
      {(hasMultiKills || hasHighlights) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          {hasMultiKills && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-fg-mid)] mb-1">多杀分布</h4>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {mk.two > 0 && <span>2K <span className="font-mono text-[var(--color-fg)]">{mk.two}</span></span>}
                {mk.three > 0 && <span>3K <span className="font-mono text-[var(--color-fg)]">{mk.three}</span></span>}
                {mk.four > 0 && <span>4K <span className="font-mono text-[var(--color-accent)]">{mk.four}</span></span>}
                {mk.five > 0 && <span>ACE <span className="font-mono text-[var(--color-warn)]">{mk.five}</span></span>}
              </div>
            </div>
          )}
          {hasHighlights && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-fg-mid)] mb-1">高光击杀</h4>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {hl.wallbang > 0 && <span>穿墙 <span className="font-mono text-[var(--color-fg)]">{hl.wallbang}</span></span>}
                {hl.noScope > 0 && <span>盲狙 <span className="font-mono text-[var(--color-fg)]">{hl.noScope}</span></span>}
                {hl.collateral > 0 && <span>一穿多 <span className="font-mono text-[var(--color-accent)]">{hl.collateral}</span></span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 残局细分 + 致盲 */}
      {(clutchRows.length > 0 || data.blindsEnemies > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          {clutchRows.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-fg-mid)] mb-1">残局细分</h4>
              <div className="divide-y divide-[var(--color-border-subtle)]">{clutchRows}</div>
            </div>
          )}
          {data.blindsEnemies > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-fg-mid)] mb-1">闪光致盲</h4>
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-[var(--color-fg-mid)]">致盲敌人</span>
                <span className="font-mono">{data.blindsEnemies} 次</span>
              </div>
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-[var(--color-fg-mid)]">总致盲时长</span>
                <span className="font-mono">{data.blindsDuration.toFixed(1)} 秒</span>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
