"use client";
import { useEffect, useRef, useState } from "react";
import { claimBetRelief as telemetry_claimBetRelief, getBetRelief } from "@/actions/bet";
import type { BetReliefDTO } from "@/lib/bet/relief";
import { getFreePredictionBoard, getFreePredictionRanking, submitFreePrediction as telemetry_submitFreePrediction } from "@/actions/free-predictions";
import { ErrorCode } from "@/lib/errors";
import type { FreePredictionMatchDTO } from "@/lib/free-predictions/types";
import type { ComponentProps } from "react";
import { BetBoard } from "./BetBoard";
import { freeMatchRow, freePredictionPanel, freeRankingModel } from "./free-prediction-presentation";
import type { FreePredictionModel } from "./presentation-contract";
import { observeAction } from "@/lib/telemetry/client";

const claimBetRelief = observeAction("bet.claimBetRelief", telemetry_claimBetRelief);
const submitFreePrediction = observeAction("free-predictions.submitFreePrediction", telemetry_submitFreePrediction);

export function UnifiedBetBoard({ freeMatches, reliefModel, ...props }: Omit<ComponentProps<typeof BetBoard>, "predictions" | "predictionControls" | "predictionMatchRows" | "relief"> & { freeMatches: FreePredictionMatchDTO[]; reliefModel: BetReliefDTO }) {
  const [snapshot, setSnapshot] = useState({ origin: freeMatches, value: freeMatches });
  const matches = snapshot.origin === freeMatches ? snapshot.value : freeMatches;
  const [readError, setReadError] = useState(false);
  const requests = useRef(new Map<string, string>());
  const readSequence = useRef(0);
  const seasonId = props.initial.seasonId;
  useEffect(() => {
    let alive = true;
    const invalidateRead = () => { ++readSequence.current; };
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const sequence = ++readSequence.current;
      try {
        const result = await getFreePredictionBoard({ seasonId });
        if (!alive || sequence !== readSequence.current) return;
        if (result.success) { setSnapshot({ origin: freeMatches, value: result.data.matches }); setReadError(false); }
        else setReadError(true);
      } catch { if (alive && sequence === readSequence.current) setReadError(true); }
    }
    const timer = setInterval(() => void refresh(), 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; invalidateRead(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [freeMatches, seasonId]);
  async function refreshPanel(model: FreePredictionModel) {
    const sequence = ++readSequence.current;
    const result = await getFreePredictionBoard({ seasonId });
    if (sequence !== readSequence.current) return { success: false as const, error: { code: ErrorCode.INTERNAL_ERROR, message: "预测状态已更新，请重试。" } };
    if (!result.success) return result;
    setReadError(false);
    const match = result.data.matches.find(row => row.matchId === model.matchId);
    setSnapshot({ origin: freeMatches, value: result.data.matches });
    if (!match) return { success: false as const, error: { code: ErrorCode.NOT_FOUND, message: "比赛预测暂不可用，请刷新页面。" } };
    return { success: true as const, data: freePredictionPanel(match, model.kind) };
  }
  return <>
    {readError && <p role="status" className="mb-3 text-sm text-[var(--color-warn)]">预测状态更新失败，请刷新后查看。</p>}
    <BetBoard {...props} rankingRefreshAction={async sort => {
      const result = await getFreePredictionRanking({ seasonId, sort });
      return result.success ? { success: true, data: freeRankingModel(result.data) } : result;
    }} relief={{ model: reliefModel, refreshAction: () => getBetRelief({ seasonId }), claimAction: async day => {
      const result = await claimBetRelief({ seasonId, day });
      return result.success ? { success: true, data: result.data.eligibility } : result;
    } }} predictionMatchRows={matches.map(freeMatchRow)} predictions={matches.flatMap(match => [freePredictionPanel(match, "winner"), freePredictionPanel(match, "bp")])} predictionControls={{ refreshAction: refreshPanel, submitAction: async (model, selection) => {
      const key = JSON.stringify([model.matchId, model.kind, [...selection].sort()]);
      if (!requests.current.has(key)) requests.current.clear();
      const requestId = requests.current.get(key) ?? crypto.randomUUID();
      requests.current.set(key, requestId);
      const result = await submitFreePrediction({ seasonId, matchId: model.matchId, kind: model.kind === "winner" ? "result" : "bp", selection, requestId });
      if (!result.success) { requests.current.delete(key); return result; }
      requests.current.delete(key);
      return refreshPanel(model);
    }}}/>
  </>;
}
