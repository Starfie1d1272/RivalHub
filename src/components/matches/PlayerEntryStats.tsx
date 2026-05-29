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
  const tradeKills = new Map<number, KillFeedItem[]>();

  for (const k of kills) {
    // 每round第一击杀
    if (!firstKills.has(k.roundNumber)) {
      firstKills.set(k.roundNumber, k);
    }
    // 每round第一死亡（按victim看）
    if (!firstDeaths.has(k.roundNumber)) {
      firstDeaths.set(k.roundNumber, k);
    }
    // tradeKill
    if (k.tradeKill) {
      const existing = tradeKills.get(k.roundNumber) ?? [];
      existing.push(k);
      tradeKills.set(k.roundNumber, existing);
    }
  }

  return { firstKills, firstDeaths, tradeKills };
}

export function PlayerEntryStats({
  kills,
  playerStats,
  playerNameMap,
}: PlayerEntryStatsProps) {
  const [selectedSteamId, setSelectedSteamId] = useState<string>("__all__");

  const players = useMemo(
    () =>
      playerStats
        .filter(
          (s) =>
            s.firstKillCount != null ||
            s.firstDeathCount != null ||
            s.tradeKillCount != null
        )
        .sort((a, b) => (b.firstKillCount ?? 0) - (a.firstKillCount ?? 0)),
    [playerStats]
  );

  const { firstKills, firstDeaths, tradeKills } = useMemo(
    () => getPerRoundEntries(kills),
    [kills]
  );

  const relevantKills = useMemo(() => {
    let items = kills;
    if (selectedSteamId !== "__all__") {
      items = items.filter(
        (k) =>
          k.killerSteamId64 === selectedSteamId ||
          k.victimSteamId64 === selectedSteamId
      );
    }
    return items;
  }, [kills, selectedSteamId]);

  // 找到该选手相关的首杀/首死/换命事件
  const entryEvents = useMemo(() => {
    const events: {
      round: number;
      type: "firstKill" | "firstDeath" | "tradeKill" | "tradeDeath";
      killer: string | null;
      victim: string | null;
      weapon: string | null;
      tradeKill: boolean | null;
    }[] = [];

    for (const k of relevantKills) {
      const isFirstKill = firstKills.get(k.roundNumber) === k;
      const isFirstDeath = firstDeaths.get(k.roundNumber) === k;

      if (isFirstKill && k.killerSteamId64 === selectedSteamId) {
        events.push({
          round: k.roundNumber,
          type: "firstKill",
          killer: k.killerSteamId64,
          victim: k.victimSteamId64,
          weapon: k.weapon,
          tradeKill: k.tradeKill,
        });
      }
      if (isFirstDeath && k.victimSteamId64 === selectedSteamId) {
        events.push({
          round: k.roundNumber,
          type: "firstDeath",
          killer: k.killerSteamId64,
          victim: k.victimSteamId64,
          weapon: k.weapon,
          tradeKill: null,
        });
      }
      if (k.tradeKill && k.killerSteamId64 === selectedSteamId) {
        events.push({
          round: k.roundNumber,
          type: "tradeKill",
          killer: k.killerSteamId64,
          victim: k.victimSteamId64,
          weapon: k.weapon,
          tradeKill: true,
        });
      }
    }

    events.sort((a, b) => a.round - b.round);
    return events;
  }, [relevantKills, firstKills, firstDeaths, selectedSteamId]);

  const typeLabel: Record<string, string> = {
    firstKill: "首杀",
    firstDeath: "首死",
    tradeKill: "换命",
  };

  return (
    <Panel label="选手首杀倾向">
      <div className="space-y-3">
        <select
          value={selectedSteamId}
          onChange={(e) => setSelectedSteamId(e.target.value)}
          className={cn(
            "w-full text-sm p-2 rounded",
            "bg-[var(--color-bg-subtle)] text-[var(--color-fg)]",
            "border border-[var(--color-border)]"
          )}
        >
          <option value="__all__">所有选手</option>
          {players.map((p) => (
            <option key={p.steamId64} value={p.steamId64}>
              {playerNameMap[p.steamId64] ?? p.steamId64}
              {" — "}
              FK:{p.firstKillCount ?? 0} FD:{p.firstDeathCount ?? 0} TK:
              {p.tradeKillCount ?? 0}
            </option>
          ))}
        </select>
      </div>

      {/* 选手维度汇总 */}
      {selectedSteamId !== "__all__" && (() => {
        const p = players.find(p => p.steamId64 === selectedSteamId);
        if (!p) return null;
        const fk = p.firstKillCount ?? 0;
        const fd = p.firstDeathCount ?? 0;
        const total = fk + fd;
        const entryRate = total > 0 ? ((fk / total) * 100).toFixed(1) : "—";
        return (
          <div className="grid grid-cols-3 gap-2 text-center mt-2 mb-3">
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-success)]">{fk}</div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">首杀</div>
            </div>
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-error)]">{fd}</div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">首死</div>
            </div>
            <div className="bg-[var(--color-bg-subtle)] rounded-lg p-2">
              <div className="text-lg font-bold text-[var(--color-accent)]">{entryRate}{entryRate !== "—" ? "%" : ""}</div>
              <div className="text-[10px] text-[var(--color-fg-dim)]">Entry%</div>
            </div>
          </div>
        );
      })()}

      <table className="w-full text-sm mt-3">
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
          {entryEvents.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center py-4 text-[var(--color-fg-mid)]">
                无首杀/换命事件
              </td>
            </tr>
          )}
          {entryEvents.map((ev, i) => (
            <tr
              key={`${ev.round}-${ev.type}-${i}`}
              className={cn(
                "border-b border-[var(--color-border-subtle)]",
                ev.type === "firstKill" && "text-[var(--color-success)]",
                ev.type === "firstDeath" && "text-[var(--color-error)]",
                ev.type === "tradeKill" && "text-[var(--color-warn)]"
              )}
            >
              <td className="py-1 px-2">{ev.round}</td>
              <td className="py-1 px-2">{typeLabel[ev.type]}</td>
              <td className="py-1 px-2">
                {playerNameMap[ev.killer ?? ""] ?? ev.killer ?? "—"}
              </td>
              <td className="py-1 px-2">
                {playerNameMap[ev.victim ?? ""] ?? ev.victim ?? "—"}
              </td>
              <td className="py-1 px-2 text-xs text-[var(--color-fg-mid)]">
                {ev.weapon ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
