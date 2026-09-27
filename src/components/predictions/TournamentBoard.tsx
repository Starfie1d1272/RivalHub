"use client";
import React, { useMemo, useState } from "react";
import { TeamLogo } from "@/components/teams/TeamLogo";
import type { Baseline, SimMatch, SimStage } from "@/lib/predictions/types";
import { SimulationMatchCard } from "./SimulationMatchCard";
export function TournamentBoard({
  stage,
  teams,
  editable,
  onChoose,
}: {
  stage: SimStage;
  teams: Baseline["teams"];
  editable: boolean;
  onChoose: (match: SimMatch, winner: string) => void;
}) {
  const [view, setView] = useState<"flow" | "compact" | "list">("flow");
  const teamMap = useMemo(() => new Map(teams.map((team) => [team.teamId, team])), [teams]);
  const rounds = [...new Set(stage.matches.map((match) => match.round))].sort((a, b) => a - b);
  const lastRound = rounds.at(-1) ?? 1;
  const swiss = stage.standings.length > 0;
  const card = (match: SimMatch) => (
    <SimulationMatchCard
      key={match.key}
      match={match}
      stageKey={stage.key}
      teams={teamMap}
      compact={view === "compact"}
      busy={false}
      editable={editable}
      onChoose={onChoose}
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="赛程展示方式" className="flex gap-1">
          {([ ["flow", "晋级路径"], ["compact", "紧凑对阵"], ["list", "轮次列表"] ] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
              className={`min-h-11 border-b-2 px-3 text-xs focus-visible:outline-2 ${view === key ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-transparent text-[var(--color-fg-mid)]"}`}>{label}</button>
          ))}
        </div>
        <details className="text-xs text-[var(--color-fg-mid)]">
          <summary className="cursor-pointer">如何推演</summary>
          <p className="max-w-sm py-2">点选队伍推演胜者；虚线为种子预览，实线为官方赛况，强调边框为你的选择。预览不会写入预测单。悬停比赛查看赛制和来源。</p>
        </details>
      </div>
      <div
        className="overflow-x-auto pb-3 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        tabIndex={0}
        role="region"
        aria-label={swiss ? "Swiss 完整赛事推演" : "淘汰赛完整晋级路径"}
      >
        {view === "list" ? (
          <div className="space-y-6">
            {rounds.map((round) => <section key={round}>
              <h3 className="mb-3 border-b border-[var(--color-border)] pb-2 text-sm">第 {round} 轮</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {stage.matches.filter((match) => match.round === round).map((match) => <div key={match.key}>
                  <p className="mb-1 text-xs text-[var(--color-fg-mid)]">{match.record ? `${match.record.wins}–${match.record.losses} · ` : ""}{match.format.toUpperCase()}</p>
                  {card(match)}
                </div>)}
              </div>
            </section>)}
          </div>
        ) : swiss ? (
          <div className="grid items-start gap-4" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(${view === "compact" ? 240 : 180}px, 1fr)) 150px` }}>
            {rounds.map((round) => {
              const matches = stage.matches.filter((m) => m.round === round);
              const records = [
                ...new Set(
                  matches.map(
                    (m) => `${m.record?.wins ?? 0}–${m.record?.losses ?? 0}`,
                  ),
                ),
              ];
              return (
                <section key={round} className="space-y-4">
                  <h3 className="border-b border-[var(--color-border)] pb-2 text-xs text-[var(--color-fg-mid)]">
                    第 {round} 轮
                  </h3>
                  {records.map((record) => {
                    const group = matches.filter(
                      (m) =>
                        `${m.record?.wins ?? 0}–${m.record?.losses ?? 0}` ===
                        record,
                    );
                    const state = group[0]?.record;
                    return (
                      <div
                        key={record}
                        className="space-y-2"
                        data-testid={`record-${round}-${record}`}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <h4 className="font-mono text-lg font-semibold">
                            {record}
                          </h4>
                          <span className="text-[10px] text-[var(--color-fg-mid)]">
                            {state?.wins === 2 && state.losses === 2
                              ? "晋级 / 淘汰"
                              : state?.wins === 2
                                ? "晋级赛"
                                : state?.losses === 2
                                  ? "淘汰赛"
                                  : "争取晋级"}
                          </span>
                        </div>
                        {group.map(card)}
                      </div>
                    );
                  })}
                </section>
              );
            })}
            <section className="space-y-3">
              <h3 className="border-b border-[var(--color-border)] pb-2 text-xs">
                {stage.complete ? "推演结果" : "预览结果"}
              </h3>
              {[
                [3, 0],
                [3, 1],
                [3, 2],
                [2, 3],
                [1, 3],
                [0, 3],
              ].map(([wins, losses]) => (
                <div
                  key={`${wins}-${losses}`}
                  className="border border-[var(--color-border)] p-2"
                >
                  <h4 className="mb-2 flex justify-between text-xs">
                    <span>{wins === 3 ? "晋级" : "淘汰"}</span>
                    <strong className="tabular-nums">
                      {wins}–{losses}
                    </strong>
                  </h4>
                  <div className="space-y-2">
                    {stage.standings
                      .filter((t) => t.wins === wins && t.losses === losses)
                      .map((row) => {
                        const team = teamMap.get(row.teamId);
                        return (
                          <div
                            key={row.teamId}
                            className="flex items-center gap-2 text-xs"
                          >
                            <TeamLogo
                              logoUrl={team?.logoUrl ?? null}
                              teamName={team?.name ?? "队伍"}
                              className="h-7 w-7"
                            />
                            <span className="min-w-0 break-words">
                              {team?.name}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </section>
          </div>
        ) : (
          <div className="grid gap-8" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(220px, 1fr))` }}>
            {rounds.map((round) => (
              <section key={round}>
                <h3 className="mb-4 text-sm font-semibold">
                  {["八强", "半决赛", "决赛"][round - 1]}
                </h3>
                <div
                  className="grid min-h-[400px]"
                  style={{
                    gridTemplateRows: `repeat(${stage.matches.filter((match) => match.round === round).length}, minmax(0,1fr))`,
                  }}
                >
                  {stage.matches
                    .filter((match) => match.round === round)
                    .map((match, i) => (
                      <div
                        key={match.key}
                        className="relative flex items-center"
                      >
                        {round > 1 && (
                          <span
                            aria-hidden
                            className="absolute -left-4 top-1/2 w-4 border-t border-[var(--color-border)]"
                          />
                        )}
                        <div className="w-full">{card(match)}</div>
                        {round < lastRound && (
                          <span
                            aria-hidden
                            className={`absolute -right-4 w-4 border-r border-[var(--color-border)] ${i % 2 === 0 ? "top-1/2 h-1/2 border-t" : "bottom-1/2 h-1/2 border-b"}`}
                          />
                        )}
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
