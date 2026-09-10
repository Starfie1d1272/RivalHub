"use client";

import Link from "next/link";
import type { MajorSwissStageReadModel, StageSwissRoundColumn } from "@/lib/matches/stage-read-model";

interface StageSwissReadModelProps {
  data: MajorSwissStageReadModel;
  seasonSlug: string;
}

export function StageSwissReadModel({ data, seasonSlug }: StageSwissReadModelProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-fg)]">{data.stageName}</h2>
        <p className="text-xs text-[var(--color-fg-mid)]">
          已确认第 {data.finalizedRound} 轮 · {data.advanceCount} 队晋级
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-[920px] gap-4 pb-2">
          {data.rounds.map((round) => <SwissRoundColumn key={round.round} round={round} seasonSlug={seasonSlug} />)}
        </div>
      </div>
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[var(--color-panel-hi)] text-left text-xs text-[var(--color-fg-mid)]">
            <tr><th className="px-3 py-2">种子</th><th className="px-3 py-2">队伍</th><th className="px-3 py-2">战绩</th><th className="px-3 py-2">状态</th></tr>
          </thead>
          <tbody>
            {data.competitionEntries.map((entry) => (
              <tr key={entry.entryId} className="border-t border-[var(--color-border)]">
                <td className="px-3 py-2 tabular-nums">{entry.seed}</td>
                <td className="px-3 py-2">{entry.teamName}</td>
                <td className="px-3 py-2 tabular-nums">{entry.wins}:{entry.losses}</td>
                <td className="px-3 py-2">{entry.status === "advanced" ? "晋级" : entry.status === "eliminated" ? "淘汰" : "进行中"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SwissRoundColumn({ round, seasonSlug }: { round: StageSwissRoundColumn; seasonSlug: string }) {
  return (
    <div className="w-[280px] shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">第 {round.round} 轮</h3>
        <span className="text-xs text-[var(--color-fg-mid)]">{round.status === "finished" ? "已结束" : round.status === "active" ? "进行中" : "待开始"}</span>
      </div>
      <div className="space-y-3">
        {round.groups.length === 0 ? <p className="text-xs text-[var(--color-fg-mid)]">暂无对阵</p> : round.groups.map((group) => (
          <div key={group.record} className="space-y-1">
            <p className="text-[11px] font-medium text-[var(--color-fg-mid)]">{group.record}</p>
            {group.matchups.map((match) => (
              <Link
                key={match.matchId}
                href={`/${seasonSlug}/matches/${match.matchId}`}
                className="block rounded border border-[var(--color-border)] p-2 text-xs hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                <div className="flex justify-between gap-2"><span>{match.teamAName}</span><span>{match.scoreA ?? "–"}</span></div>
                <div className="flex justify-between gap-2"><span>{match.teamBName}</span><span>{match.scoreB ?? "–"}</span></div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
