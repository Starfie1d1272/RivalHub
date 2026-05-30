"use client";

import React, { useState, useMemo } from "react";
import { Panel } from "@/components/rivalhub";
import { cn } from "@/lib/utils/cn";
import type { DemoPlayerStatRow, KillFeedItem } from "@/actions/demo-detail";

interface PlayerEntryStatsProps {
  kills: KillFeedItem[];
  playerStats: DemoPlayerStatRow[];
  playerNameMap: Record<string, string>;
}

/** 按 round 分组，找到每个 round 的第一笔击杀（首杀）和第一笔死亡（首死） */
function getPerRoundEntries(kills: KillFeedItem[]) {
  const firstKills = new Map<number, KillFeedItem>();
  const firstDeaths = new Map<number, KillFeedItem>();

  for (const k of kills) {
    if (!firstKills.has(k.roundNumber)) firstKills.set(k.roundNumber, k);
    if (!firstDeaths.has(k.roundNumber)) firstDeaths.set(k.roundNumber, k);
  }

  return { firstKills, firstDeaths };
}

interface EntrySummary {
  steamId64: string;
  name: string;
  fk: number;
  fd: number;
  tk: number;
  net: number;
  entryRate: number | null;
}

export function PlayerEntryStats({
  kills,
  playerStats,
  playerNameMap,
}: PlayerEntryStatsProps) {
  const [selectedSteamId, setSelectedSteamId] = useState<string>("__all__");

  // 全员 Entry 汇总（默认视图）
  const summaries = useMemo<EntrySummary[]>(
    () =>
      playerStats
        .filter(
          (s) =>
            s.firstKillCount != null ||
            s.firstDeathCount != null ||
            s.tradeKillCount != null,
        )
        .map((s) => {
          const fk = s.firstKillCount ?? 0;
          const fd = s.firstDeathCount ?? 0;
          const total = fk + fd;
          return {
            steamId64: s.steamId64,
            name: playerNameMap[s.steamId64] ?? s.steamId64.slice(0, 8),
            fk,
            fd,
            tk: s.tradeKillCount ?? 0,
            net: fk - fd,
            entryRate: total > 0 ? fk / total : null,
          };
        })
        .sort((a, b) => b.fk - a.fk || b.net - a.net),
    [playerStats, playerNameMap],
  );

  const { firstKills, firstDeaths } = useMemo(
    () => getPerRoundEntries(kills),
    [kills],
  );

  // 选中选手的逐回合首杀/首死/换命事件
  const entryEvents = useMemo(() => {
    if (selectedSteamId === "__all__") return [];
    const events: {
      round: number;
      type: "firstKill" | "firstDeath" | "tradeKill";
      killer: string | null;
      victim: string | null;
      weapon: string | null;
    }[] = [];

    for (const k of kills) {
      const isFirstKill = firstKills.get(k.roundNumber) === k;
      const isFirstDeath = firstDeaths.get(k.roundNumber) === k;

      if (isFirstKill && k.killerSteamId64 === selectedSteamId) {
        events.push({
          round: k.roundNumber,
          type: "firstKill",
          killer: k.killerSteamId64,
          victim: k.victimSteamId64,
          weapon: k.weapon,
        });
      }
      if (isFirstDeath && k.victimSteamId64 === selectedSteamId) {
        events.push({
          round: k.roundNumber,
          type: "firstDeath",
          killer: k.killerSteamId64,
          victim: k.victimSteamId64,
          weapon: k.weapon,
        });
      }
      if (k.tradeKill && k.killerSteamId64 === selectedSteamId) {
        events.push({
          round: k.roundNumber,
          type: "tradeKill",
          killer: k.killerSteamId64,
          victim: k.victimSteamId64,
          weapon: k.weapon,
        });
      }
    }

    events.sort((a, b) => a.round - b.round);
    return events;
  }, [kills, firstKills, firstDeaths, selectedSteamId]);

  const typeLabel: Record<string, string> = {
    firstKill: "首杀",
    firstDeath: "首死",
    tradeKill: "换命",
  };

  const selected =
    selectedSteamId !== "__all__"
      ? summaries.find((s) => s.steamId64 === selectedSteamId)
      : null;

  return (
    <Panel label="Entry 对枪 · 首杀 / 首死">
      {summaries.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-muted)] italic py-4 text-center">
          暂无 Entry 数据
        </p>
      ) : selected ? (
        /* —— 单选手下钻视图 —— */
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--color-fg)]">{selected.name}</span>
            <button
              type="button"
              onClick={() => setSelectedSteamId("__all__")}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              ← 返回全部
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-success)]">{selected.fk}</div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">首杀</div>
            </div>
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-error)]">{selected.fd}</div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">首死</div>
            </div>
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-accent)]">
                {selected.entryRate != null ? `${(selected.entryRate * 100).toFixed(0)}%` : "—"}
              </div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">Entry 成功率</div>
            </div>
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-warn)]">{selected.tk}</div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">换命</div>
            </div>
          </div>

          {entryEvents.length === 0 ? (
            <p className="text-sm text-[var(--color-fg-muted)] italic py-4 text-center">
              该选手本场无首杀 / 首死 / 换命事件
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-[var(--color-fg-mid)] border-b border-[var(--color-border)]">
                  <th className="text-left py-1 px-2">Round</th>
                  <th className="text-left py-1 px-2">类型</th>
                  <th className="text-left py-1 px-2">击杀者</th>
                  <th className="text-left py-1 px-2">阵亡者</th>
                  <th className="text-left py-1 px-2">武器</th>
                </tr>
              </thead>
              <tbody>
                {entryEvents.map((ev, i) => (
                  <tr
                    key={`${ev.round}-${ev.type}-${i}`}
                    className={cn(
                      "border-b border-[var(--color-border-subtle)]",
                      ev.type === "firstKill" && "text-[var(--color-success)]",
                      ev.type === "firstDeath" && "text-[var(--color-error)]",
                      ev.type === "tradeKill" && "text-[var(--color-warn)]",
                    )}
                  >
                    <td className="py-1 px-2">{ev.round}</td>
                    <td className="py-1 px-2">{typeLabel[ev.type]}</td>
                    <td className="py-1 px-2">{playerNameMap[ev.killer ?? ""] ?? ev.killer ?? "—"}</td>
                    <td className="py-1 px-2">{playerNameMap[ev.victim ?? ""] ?? ev.victim ?? "—"}</td>
                    <td className="py-1 px-2 text-xs text-[var(--color-fg-mid)]">{ev.weapon ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* —— 全员 Entry 排行（默认视图）—— */
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-fg-dim)]">点击选手查看逐回合首杀 / 首死明细</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-dim)] text-xs uppercase tracking-wider">
                  <th className="text-left px-2 py-2">选手</th>
                  <th className="text-right px-2 py-2">首杀</th>
                  <th className="text-right px-2 py-2">首死</th>
                  <th className="text-right px-2 py-2">净首杀</th>
                  <th className="text-right px-2 py-2">Entry%</th>
                  <th className="text-right px-2 py-2">换命</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr
                    key={s.steamId64}
                    onClick={() => setSelectedSteamId(s.steamId64)}
                    className="border-b border-[var(--color-border)] last:border-0 cursor-pointer hover:bg-[var(--color-bg-subtle)]"
                  >
                    <td className="px-2 py-2 font-medium text-[var(--color-accent)]">{s.name}</td>
                    <td className="px-2 py-2 text-right font-mono text-[var(--color-success)]">{s.fk}</td>
                    <td className="px-2 py-2 text-right font-mono text-[var(--color-error)]">{s.fd}</td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right font-mono",
                        s.net > 0 && "text-[var(--color-success)]",
                        s.net < 0 && "text-[var(--color-error)]",
                      )}
                    >
                      {s.net > 0 ? `+${s.net}` : s.net}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {s.entryRate != null ? `${(s.entryRate * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-[var(--color-warn)]">{s.tk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
