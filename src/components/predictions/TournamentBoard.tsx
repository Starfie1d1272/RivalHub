"use client";
import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Columns3,
  LayoutGrid,
  List,
} from "lucide-react";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import {
  MAJOR_SWISS_WIN_THRESHOLD,
  MAJOR_SWISS_LOSS_THRESHOLD,
} from "@/lib/major/swiss";
import { TeamLogo } from "@/components/teams/TeamLogo";
import type { Baseline, SimMatch, SimStage } from "@/lib/predictions/types";
import { SimulationMatchCard } from "./SimulationMatchCard";
import styles from "./tournament.module.css";
type ResultGroup = {
  key: string;
  label: string;
  record: string;
  ids: string[];
  tone: "advance" | "eliminated" | "champion";
};
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
  const [mobileRound, setMobileRound] = useState<number | "results">(
    stage.matches[0]?.round ?? 1,
  );
  const teamMap = useMemo(
    () => new Map(teams.map((t) => [t.teamId, t])),
    [teams],
  );
  const rounds = [...new Set(stage.matches.map((m) => m.round))].sort(
    (a, b) => a - b,
  );
  const policy = stage.swissPolicy ?? {
    winThreshold: MAJOR_SWISS_WIN_THRESHOLD,
    lossThreshold: MAJOR_SWISS_LOSS_THRESHOLD,
  };
  const swiss = stage.standings.length > 0;
  const card = (m: SimMatch) => (
    <SimulationMatchCard
      key={m.key}
      match={m}
      stageKey={stage.key}
      teams={teamMap}
      compact={view === "compact"}
      busy={false}
      editable={editable}
      onChoose={onChoose}
    />
  );
  // These are display buckets from the simulator's results, never new pairings.
  function results(beforeRound: number): ResultGroup[] {
    if (swiss)
      return [
        ...Array.from({ length: policy.lossThreshold }, (_, losses) => ({
          wins: policy.winThreshold,
          losses,
        })),
        ...Array.from({ length: policy.winThreshold }, (_, i) => ({
          wins: policy.winThreshold - i - 1,
          losses: policy.lossThreshold,
        })),
      ]
        .filter((r) =>
          view === "flow"
            ? r.wins + r.losses === beforeRound - 1
            : r.wins + r.losses < beforeRound,
        )
        .map((r) => ({
          key: `${r.wins}-${r.losses}`,
          record: `${r.wins}–${r.losses}`,
          label: r.wins === policy.winThreshold ? "Qualified" : "Eliminated",
          tone: r.wins === policy.winThreshold ? "advance" : "eliminated",
          ids: stage.standings
            .filter((t) => t.wins === r.wins && t.losses === r.losses)
            .map((t) => t.teamId),
        }));
    const last = rounds.at(-1)!;
    const final = stage.matches.find((m) => m.round === last);
    const groups: ResultGroup[] = [];
    if (beforeRound > last && final?.winner)
      groups.push({
        key: "champion",
        label: "Champion",
        record: `${last}–0`,
        tone: "champion",
        ids: [final.winner],
      });
    for (let r = last; r >= 1; r--)
      if (r < beforeRound && (view !== "flow" || r === beforeRound - 1)) {
        const ids = stage.matches
          .filter((m) => m.round === r && m.winner)
          .map((m) => (m.winner === m.a ? m.b : m.a));
        groups.push({
          key: `exit-${r}`,
          label: r === last ? "Runner-up" : r === last - 1 ? "SF" : "QF",
          record: `${r - 1}–1`,
          tone: "eliminated",
          ids,
        });
      }
    return groups;
  }
  const resultCard = (group: ResultGroup) => (
    <div key={group.key} className={styles.result} data-tone={group.tone}>
      <h4>
        <span>{group.label}</span>
        <strong>{group.record}</strong>
      </h4>
      <div className={view === "flow" ? styles.resultLogos : styles.resultRows}>
        {group.ids.map((id) => (
          <div key={id} className={styles.resultTeam}>
            <TeamLogo
              teamName={teamMap.get(id)?.name ?? "队伍"}
              logoUrl={teamMap.get(id)?.logoUrl ?? null}
              className={view === "flow" ? styles.logo : styles.smallLogo}
            />
            <span>{teamMap.get(id)?.name}</span>
          </div>
        ))}
        {!group.ids.length && <span className={styles.waiting}>等待赛果</span>}
      </div>
    </div>
  );
  const roundBody = (round: number) => {
    const matches = stage.matches.filter((m) => m.round === round);
    const exits = results(round);
    const upper = exits.filter((g) => g.tone !== "eliminated");
    const lower = exits.filter((g) => g.tone === "eliminated");
    const records = [
      ...new Set(
        matches.map((m) =>
          m.record ? `${m.record.wins}–${m.record.losses}` : `${round - 1}–0`,
        ),
      ),
    ];
    return (
      <>
        {upper.map(resultCard)}
        {records.map((record) => (
          <div
            key={record}
            className={styles.recordGroup}
            data-testid={`record-${round}-${record}`}
          >
            {view !== "flow" && (
              <h4 className={styles.recordHeading}>
                {record}{" "}
                <small>
                  (
                  {matches
                    .find(
                      (m) =>
                        (m.record
                          ? `${m.record.wins}–${m.record.losses}`
                          : `${round - 1}–0`) === record,
                    )
                    ?.format.toUpperCase()}
                  )
                </small>
              </h4>
            )}
            {view === "flow" && <span className="sr-only">{record}</span>}
            <div className={styles.groupMatches}>
              {matches
                .filter(
                  (m) =>
                    (m.record
                      ? `${m.record.wins}–${m.record.losses}`
                      : `${round - 1}–0`) === record,
                )
                .map(card)}
            </div>
          </div>
        ))}
        {lower.map(resultCard)}
      </>
    );
  };
  return (
    <div className={styles.board} data-layout={view}>
      <div className={styles.toolbar}>
        <div
          role="group"
          aria-label="赛程展示方式"
          className={styles.viewSwitch}
        >
          {(
            [
              ["flow", "晋级路径", Columns3],
              ["compact", "紧凑对阵", List],
              ["list", "轮次列表", LayoutGrid],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={styles.legend}>
          <span>○ 系统补全</span>
          <span>● 官方赛果</span>
          <span>✓ 我的选择</span>
          <HelpTooltip
            label="如何推演"
            content="点选队伍推演胜者。未结束比赛默认高种子获胜，模拟选择不显示虚构比分。修改上游会重算后续；刷新清空选择。推演不会自动提交 Pick’Em。"
          />
        </div>
      </div>
      {view === "list" && (
        <nav className={styles.mobileRounds} aria-label="当前展示轮次">
          {rounds.map((round) => (
            <button
              key={round}
              type="button"
              aria-label={`展示第 ${round} 轮`}
              aria-pressed={mobileRound === round}
              onClick={() => setMobileRound(round)}
            >
              R{round}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={mobileRound === "results"}
            onClick={() => setMobileRound("results")}
          >
            结果
          </button>
        </nav>
      )}
      <div
        className={styles.viewport}
        tabIndex={0}
        role="region"
        aria-label={swiss ? "Swiss 完整赛事推演" : "淘汰赛完整晋级路径"}
      >
        <div
          className={styles.rounds}
          style={{ "--round-count": rounds.length + 1 } as React.CSSProperties}
        >
          {rounds.map((round) => (
            <section
              key={round}
              className={styles.round}
              data-mobile-active={mobileRound === round}
            >
              <h3 className={styles.roundTitle}>
                {view === "list" && <ArrowDown size={18} />}
                <span>ROUND {round}</span>
                {view === "list" && <ArrowDown size={18} />}
              </h3>
              <div className={styles.roundContent}>{roundBody(round)}</div>
              {view !== "list" && (
                <ArrowRight
                  className={styles.roundArrow}
                  size={22}
                  aria-hidden
                />
              )}
            </section>
          ))}
          <section
            className={styles.round}
            aria-label="最终结果"
            data-mobile-active={mobileRound === "results"}
          >
            <h3 className={`${styles.roundTitle} ${styles.finalTitle}`}>
              FINAL RESULTS{" "}
              <span className="sr-only">
                {stage.complete ? "推演结果" : "预览结果"}
              </span>
            </h3>
            <div className={styles.roundContent}>
              {results((rounds.at(-1) ?? 0) + 1).map(resultCard)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
