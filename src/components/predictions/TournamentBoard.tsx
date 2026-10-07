"use client";
import React, { useMemo, useState, useSyncExternalStore } from "react";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import {
  MAJOR_SWISS_WIN_THRESHOLD,
  MAJOR_SWISS_LOSS_THRESHOLD,
} from "@/lib/major/swiss";
import { SwissRecordGroup, TournamentResult, swissResultRecords } from "@/components/tournament/SwissPrimitives";
import type { Baseline, SimMatch, SimStage } from "@/lib/predictions/types";
import { SimulationMatchCard } from "./SimulationMatchCard";
import { TournamentFlow } from "@/components/tournament/TournamentFlow";
type ResultGroup = {
  key: string;
  label: string;
  record: string;
  ids: string[];
  tone: "advance" | "eliminated" | "champion" | "runner-up" | "placement";
};
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
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
  // SSR buttons must remain disabled until React can handle a user's choice.
  const interactive = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [view, setView] = useState<"flow" | "compact" | "list">("flow");
  const teamMap = useMemo(
    () => new Map(teams.map((t) => [t.teamId, t])),
    [teams],
  );
  const seeds = useMemo(
    () => new Map(stage.entrants.map((entrant) => [entrant.teamId, entrant.seed])),
    [stage.entrants],
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
      seeds={seeds}
      compact={view === "compact"}
      busy={false}
      editable={editable && interactive}
      onChoose={onChoose}
    />
  );
  // These are display buckets from the simulator's results, never new pairings.
  function results(beforeRound: number): ResultGroup[] {
    if (swiss)
      return swissResultRecords(policy)
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
          tone: r === last ? "runner-up" : "placement",
          ids,
        });
      }
    return groups;
  }
  const resultCard = (group: ResultGroup) => (
    <TournamentResult key={group.key} label={group.label} record={group.record} tone={group.tone} view={view}
      teams={group.ids.map(id => ({ id, name: teamMap.get(id)?.name ?? "队伍", logoUrl: teamMap.get(id)?.logoUrl }))} />
  );
  const roundBody = (round: number) => {
    const matches = stage.matches.filter((m) => m.round === round);
    const exits = results(round);
    const upper = exits.filter((g) => g.tone === "advance" || g.tone === "champion");
    const lower = exits.filter((g) => g.tone !== "advance" && g.tone !== "champion");
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
          <SwissRecordGroup key={record} round={round} record={record}
            heading={view !== "flow" ? <>{record} <small>({matches.find(m => (m.record ? `${m.record.wins}–${m.record.losses}` : `${round - 1}–0`) === record)?.format.toUpperCase()})</small></> : undefined}>
            {matches.filter(m => (m.record ? `${m.record.wins}–${m.record.losses}` : `${round - 1}–0`) === record).map(card)}
          </SwissRecordGroup>
        ))}
        {lower.map(resultCard)}
      </>
    );
  };
  return <TournamentFlow rounds={rounds} view={view} setView={setView}
    renderRound={roundBody} finalResults={results((rounds.at(-1) ?? 0) + 1).map(resultCard)}
    label={swiss ? "Swiss 完整赛事推演" : "淘汰赛完整晋级路径"}
    resultLabel={stage.complete ? "推演结果" : "预览结果"}
    legend={<><span>○ 系统补全</span><span>● 官方赛果</span><span>✓ 我的选择</span>
      <HelpTooltip label="如何推演" content="点选队伍推演胜者。未结束比赛默认高种子获胜，模拟选择不显示虚构比分。修改上游会重算后续；刷新清空选择。推演不会自动提交 Pick’Em。" /></>} />;
}
