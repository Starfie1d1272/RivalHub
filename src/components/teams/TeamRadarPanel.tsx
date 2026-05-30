"use client";

import React, { useState } from "react";
import { Panel } from "@/components/rivalhub";
import { PlayerRadarChart } from "@/components/matches/PlayerRadarChart";
import { RadarChart, PRISM_AXES, type PrismScores } from "@/components/matches/RadarChart";
import type { HexagonScores } from "@/lib/utils/hexagon";

interface MemberData {
  userId: string;
  name: string;
  hex: HexagonScores | null;
  prism: PrismScores | null;
}

interface TeamRadarPanelProps {
  /** 成员列表（上场最多前 5 人），含六维和八维数据 */
  members: MemberData[];
  /** 队伍六维均值 */
  teamScores: HexagonScores | null;
  /** 队伍八维 PRISM 均值 */
  teamPrism: PrismScores | null;
}

type RadarTab = "hex" | "prism";

/** 队伍/赛前能力雷达面板：Tab 切换六维 / PRISM 八维 */
export function TeamRadarPanel({ members, teamScores, teamPrism }: TeamRadarPanelProps) {
  const hasHex = members.some((m) => m.hex != null) || teamScores != null;
  const hasPrism = members.some((m) => m.prism != null) || teamPrism != null;

  // 默认激活有数据的 tab，都有就选八维
  const [tab, setTab] = useState<RadarTab>(hasPrism ? "prism" : "hex");

  if (!hasHex && !hasPrism) {
    return (
      <Panel label="队伍能力图" pad={16}>
        <p className="text-sm text-[var(--color-fg-muted)] italic py-6 text-center">
          暂无能力数据
        </p>
      </Panel>
    );
  }

  const hexSeries = teamScores
    ? [
        ...members
          .filter((m) => m.hex != null)
          .map((m) => ({ name: m.name, scores: m.hex! })),
        { name: "队伍均值", scores: teamScores, color: "var(--color-fg)", strokeWidth: 3 },
      ]
    : members
        .filter((m) => m.hex != null)
        .map((m) => ({ name: m.name, scores: m.hex! }));

  const prismSeries = teamPrism
    ? [
        ...members
          .filter((m) => m.prism != null)
          .map((m) => ({ name: m.name, scores: m.prism as unknown as Record<string, number> })),
        {
          name: "队伍均值",
          scores: teamPrism as unknown as Record<string, number>,
          color: "var(--color-fg)",
          strokeWidth: 3,
        },
      ]
    : members
        .filter((m) => m.prism != null)
        .map((m) => ({ name: m.name, scores: m.prism as unknown as Record<string, number> }));

  return (
    <Panel label="队伍能力图" pad={16}>
      {/* Tab 切换 */}
      <div className="flex gap-1.5 mb-4">
        {hasPrism && (
          <button
            onClick={() => setTab("prism")}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              tab === "prism"
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
            }`}
          >
            PRISM 八维
          </button>
        )}
        {hasHex && (
          <button
            onClick={() => setTab("hex")}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              tab === "hex"
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-secondary)] text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
            }`}
          >
            六维
          </button>
        )}
      </div>

      {tab === "prism" && hasPrism && prismSeries.length > 0 ? (
        <RadarChart axes={PRISM_AXES} series={prismSeries} size={320} />
      ) : tab === "prism" ? (
        <p className="text-sm text-[var(--color-fg-muted)] italic py-4 text-center">
          暂无 PRISM 数据
        </p>
      ) : hexSeries.length > 0 ? (
        <PlayerRadarChart players={hexSeries} size={320} />
      ) : (
        <p className="text-sm text-[var(--color-fg-muted)] italic py-4 text-center">
          暂无六维数据
        </p>
      )}

      <p className="text-[11px] text-[var(--color-fg-dim)] mt-4 px-1 leading-relaxed">
        {tab === "prism"
          ? "队伍 PRISM = 上场最多的前 5 名队员八维均值（demo cohort 百分位），在本赛事内标准化。"
          : "队伍六维 = 上场最多的前 5 名队员六维均值，六维评分在本赛事内标准化。"}
      </p>
    </Panel>
  );
}
