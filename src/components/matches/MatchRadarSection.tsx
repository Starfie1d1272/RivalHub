"use client";

import React, { useState } from "react";
import { Panel } from "@/components/rivalhub";
import { PlayerRadarChart } from "@/components/matches/PlayerRadarChart";
import { RadarChart, PRISM_AXES, type PrismScores } from "@/components/matches/RadarChart";
import type { HexagonScores } from "@/lib/utils/hexagon";

interface MatchRadarSectionProps {
  teamAName: string;
  teamBName: string;
  teamHexA: HexagonScores | null;
  teamHexB: HexagonScores | null;
  teamPrismA: PrismScores | null;
  teamPrismB: PrismScores | null;
}

type RadarTab = "hex" | "prism";

export function MatchRadarSection({
  teamAName,
  teamBName,
  teamHexA,
  teamHexB,
  teamPrismA,
  teamPrismB,
}: MatchRadarSectionProps) {
  const hasHex = teamHexA != null || teamHexB != null;
  const hasPrism = teamPrismA != null || teamPrismB != null;

  const [tab, setTab] = useState<RadarTab>(hasPrism ? "prism" : "hex");

  if (!hasHex && !hasPrism) return null;

  return (
    <Panel label="能力雷达" pad={16}>
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

      {tab === "prism" && hasPrism ? (
        <>
          <RadarChart
            axes={PRISM_AXES}
            series={[
              teamPrismA && {
                name: teamAName,
                scores: teamPrismA as unknown as Record<string, number>,
                color: "var(--color-accent)",
                strokeWidth: 2.5,
              },
              teamPrismB && {
                name: teamBName,
                scores: teamPrismB as unknown as Record<string, number>,
                color: "var(--color-accent-b)",
                strokeWidth: 2.5,
              },
            ].filter(Boolean) as Array<{ name: string; scores: Record<string, number>; color?: string; strokeWidth?: number }>}
            size={320}
          />
          <p className="text-[11px] text-[var(--color-fg-dim)] mt-3 px-1 leading-relaxed">
            双方队员八维 PRISM 均值对比（demo cohort 百分位），在本赛事内标准化。
          </p>
        </>
      ) : hasHex ? (
        <>
          <PlayerRadarChart
            players={[
              teamHexA && {
                name: teamAName,
                scores: teamHexA,
                color: "var(--color-accent)",
                strokeColor: "var(--color-accent)",
              },
              teamHexB && {
                name: teamBName,
                scores: teamHexB,
                color: "var(--color-accent-b)",
                strokeColor: "var(--color-accent-b)",
              },
            ].filter(Boolean) as Array<{ name: string; scores: HexagonScores; color?: string; strokeColor?: string }>}
            size={320}
          />
          <p className="text-[11px] text-[var(--color-fg-dim)] mt-3 px-1 leading-relaxed">
            双方队员六维均值对比，六维评分在本赛事内标准化。
          </p>
        </>
      ) : null}
    </Panel>
  );
}
