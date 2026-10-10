import React from "react";
import { OfficialSwissFlow } from "./OfficialSwissFlow";
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
    </section>
  );
}
