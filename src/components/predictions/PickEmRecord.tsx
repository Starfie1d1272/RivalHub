"use client";
import React from "react";
import { Panel } from "@/components/rivalhub";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import type { PickEmBoardData } from "@/lib/predictions/data";
import { predictionChallengeCapacity } from "@/lib/predictions/rules";
export function PickEmRecord({ data }: { data: PickEmBoardData }) {
  const coin = data.achievement?.coin ?? "未获得";
  const challengeCapacity = predictionChallengeCapacity(data.base.stages);
  const coinTone: Record<string, string> = {
    未获得: "border-slate-600 text-slate-400",
    青铜: "border-amber-700 text-amber-500",
    白银: "border-slate-300 text-slate-200",
    黄金: "border-yellow-400 text-yellow-300",
    钻石: "border-cyan-300 text-cyan-200",
  };
  return (
    <div className="space-y-5">
      <Panel label="观赛成就">
        <div className="flex flex-wrap items-center gap-6">
          <div
            className={`flex h-28 w-28 flex-col items-center justify-center rounded-full border-4 bg-[var(--color-panel-hi)] text-xl font-bold ${coinTone[coin]}`}
            aria-label={`纪念币：${data.achievement?.coin ?? "未获得"}`}
          >
            <span className="text-[10px] tracking-widest">RIVALHUB</span>
            {coin}
            <span className="text-[10px] tracking-widest">PICK’EM</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              {data.achievement?.challenges ?? 0} / {challengeCapacity} 项挑战
            </h2>
            <p className="text-sm">
              最高仍可达到：{data.achievement?.maximumCoin ?? "钻石"}
            </p>
            <HelpTooltip
              label="纪念币规则"
              content={`首次有效锁定获铜币；银 ${data.rules.silver}、金 ${data.rules.gold}、钻 ${data.rules.diamond} 项。成绩更正会重新计算。`}
            />
          </div>
        </div>
        <ul className="mt-5 space-y-2">
          {data.achievement?.progress.map((p) => (
            <li key={p.key} className="text-sm">
              {p.name}：{p.locked ? "✓ 有效完整提交" : "尚无有效锁定"} ·{" "}
              {p.judged
                ? `命中 ${p.hits}，成绩挑战 ${p.challenges} 项`
                : `等待正式判定${data.base.stages.find((s) => s.key === p.key)?.type === "swiss" ? `（至少 ${data.rules.swissTarget} 中）` : ""}`}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2">
        {[{ title: "Pick’Em 榜 · 命中数", rows: data.pickLeaderboard }].map(
          (board) => (
            <Panel key={board.title} label={board.title}>
              <p className="mb-3 text-xs">同分并列，展示前100位。</p>
              <ol className="space-y-2">
                {board.rows.map((row, i) => (
                  <li
                    key={i}
                    className={`flex justify-between gap-3 text-sm ${row.isMe ? "font-bold text-[var(--color-accent)]" : ""}`}
                  >
                    <span>
                      {row.rank}. {row.name}
                      {row.isMe ? "（我）" : ""}
                    </span>
                    <span>{row.value}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          ),
        )}
      </div>
    </div>
  );
}
