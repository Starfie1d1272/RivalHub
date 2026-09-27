"use client";
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
  const swiss = stage.standings.length > 0;
  const card = (match: SimMatch) => (
    <SimulationMatchCard
      key={match.key}
      match={match}
      stageKey={stage.key}
      teams={teams}
      busy={false}
      editable={editable}
      onChoose={onChoose}
    />
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-fg-mid)]">
        点选队伍推演胜者。虚线卡片为按种子补全的预览，不计入你的选择。横向滑动查看完整路径。
      </p>
      <div
        className="overflow-x-auto pb-3 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        tabIndex={0}
        role="region"
        aria-label={swiss ? "Swiss 完整赛事推演" : "淘汰赛完整晋级路径"}
      >
        {swiss ? (
          <div className="grid min-w-[1050px] grid-cols-[repeat(5,minmax(0,1fr))_150px] items-start gap-3">
            {[1, 2, 3, 4, 5].map((round) => {
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
                        const team = teams.find((t) => t.teamId === row.teamId);
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
          <div className="grid min-w-[640px] grid-cols-3 gap-8">
            {[1, 2, 3].map((round) => (
              <section key={round}>
                <h3 className="mb-4 text-sm font-semibold">
                  {["八强", "半决赛", "决赛"][round - 1]}
                </h3>
                <div
                  className="grid h-[620px]"
                  style={{
                    gridTemplateRows: `repeat(${2 ** (3 - round)}, minmax(0,1fr))`,
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
                        {round < 3 && (
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
