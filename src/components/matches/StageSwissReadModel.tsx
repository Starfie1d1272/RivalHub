import React from "react";
import { OfficialSwissFlow } from "./OfficialSwissFlow";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import type { SwissStageReadModel } from "@/lib/matches/stage-read-model";

interface StageSwissReadModelProps {
  data: SwissStageReadModel;
  seasonSlug: string;
}

export function StageSwissReadModel({ data, seasonSlug }: StageSwissReadModelProps) {
  const isQualification = data.stageKey === "play-in";
  const qualificationComplete = isQualification && data.competitionEntries.length > 0 &&
    data.competitionEntries.every((entry) => entry.status !== "active");
  const qualificationRound = data.rounds.find((round) => round.status === "active")?.round ?? data.finalizedRound + 1;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-fg)]">{isQualification ? "PLAY-IN" : data.stageName}</h2>
        <p className="text-xs text-[var(--color-fg-mid)]">
          {isQualification
            ? `${data.teamCount} → ${data.advanceCount} · BO1 · 2胜晋级 / 2负淘汰 · ${qualificationComplete ? "已结束" : `Round ${qualificationRound}`}`
            : `已确认第 ${data.finalizedRound} 轮 · ${data.advanceCount} 队晋级`}
        </p>
      </div>
      <OfficialSwissFlow data={data} seasonSlug={seasonSlug} />
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[var(--color-panel-hi)] text-left text-xs text-[var(--color-fg-mid)]">
            <tr>
              <th className="px-3 py-2">{isQualification ? "Seed" : "种子"}</th>
              <th className="px-3 py-2">{isQualification ? "Team" : "队伍"}</th>
              <th className="px-3 py-2">{isQualification ? "W-L" : "战绩"}</th>
              <th className="px-3 py-2"><span className="inline-flex items-center gap-1">BU<HelpTooltip label="Buchholz 说明" content="BU（Buchholz）为所有对手当前胜场减负场之和；同战绩队伍按 BU 从高到低排名，并据此确定下一轮组内配对顺序，配对仍需满足不重赛约束。" /></span></th>
              <th className="px-3 py-2">{isQualification ? "Status" : "状态"}</th>
            </tr>
          </thead>
          <tbody>
            {data.competitionEntries.map((entry) => (
              <tr key={entry.entryId} className="border-t border-[var(--color-border)]">
                <td className="px-3 py-2 tabular-nums">{data.seedPrefix ?? ""}{entry.seed}</td>
                <td className="px-3 py-2">{entry.teamName}</td>
                <td className="px-3 py-2 tabular-nums">{entry.wins}:{entry.losses}</td>
                <td className="px-3 py-2 tabular-nums">{entry.difficultyScore}</td>
                <td className="px-3 py-2">{entry.status === "advanced" ? "晋级" : entry.status === "eliminated" ? "淘汰" : "进行中"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
