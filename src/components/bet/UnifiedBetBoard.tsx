"use client";
import { useEffect, useRef, useState } from "react";
import { useVisiblePolling } from "@/components/use-visible-polling";
import { claimBetRelief as telemetry_claimBetRelief, getBetRelief, getUnifiedBetBoard } from "@/actions/bet";
import type { BetReliefDTO } from "@/lib/bet/relief";
import { getFreePredictionRanking, submitFreePrediction as telemetry_submitFreePrediction } from "@/actions/free-predictions";
import { ErrorCode } from "@/lib/errors";
import type { FreePredictionMatchDTO } from "@/lib/free-predictions/types";
import type { ComponentProps } from "react";
import { BetBoard } from "./BetBoard";
import { freeMatchRow, freePredictionPanel, freeRankingModel } from "./free-prediction-presentation";
import type { FreePredictionModel } from "./presentation-contract";
import { observeAction } from "@/lib/telemetry/client";

const claimBetRelief = observeAction("bet.claimBetRelief", telemetry_claimBetRelief);
const submitFreePrediction = observeAction("free-predictions.submitFreePrediction", telemetry_submitFreePrediction);

export function UnifiedBetBoard({ freeMatches, reliefModel, ...props }: Omit<ComponentProps<typeof BetBoard>, "predictions" | "predictionControls" | "predictionMatchRows" | "relief" | "refreshAction"> & { freeMatches: FreePredictionMatchDTO[]; reliefModel: BetReliefDTO }) {
  const [snapshot, setSnapshot] = useState({ origin: props.initial, freeOrigin:freeMatches, bet:props.initial, matches:freeMatches });
  const current = snapshot.origin === props.initial && snapshot.freeOrigin === freeMatches;
  const matches = current ? snapshot.matches : freeMatches;
  const bet = current ? snapshot.bet : props.initial;
  const [readError, setReadError] = useState(false);
  const requests = useRef(new Map<string, string>());
  const readSequence = useRef(0);
  const inFlight = useRef<ReturnType<typeof getUnifiedBetBoard> | null>(null);
  const alive = useRef(true);
  const seasonId = props.initial.seasonId;
  useEffect(() => {
    alive.current = true;
    const sequenceRef = readSequence;
    return () => { alive.current = false; ++sequenceRef.current; };
  }, [props.initial, freeMatches, props.view, props.matchFilter]);
  async function refresh(force = true): ReturnType<typeof getUnifiedBetBoard> {
    const superseded = {success:false as const,error:{code:ErrorCode.INTERNAL_ERROR,message:"预测状态已更新，请重试。"}};
    if (!force && inFlight.current) return superseded;
    const sequence = ++readSequence.current;
    // A mutation read waits for the old request, discards its result, then reads fresh facts.
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    if (!alive.current || sequence !== readSequence.current) return superseded;
    const request = getUnifiedBetBoard({seasonId,view:props.view,matchId:props.matchFilter??undefined});
    inFlight.current = request;
    try {
      const result = await request;
      if (!alive.current || sequence !== readSequence.current) return superseded;
      if (result.success) {
        setSnapshot({origin:props.initial,freeOrigin:freeMatches,
          bet:{...result.data.bet,records:props.initial.records,recordsHasMore:props.initial.recordsHasMore},matches:result.data.free.matches});
        setReadError(false);
      } else setReadError(true);
      return result;
    } catch {
      if (alive.current && sequence === readSequence.current) setReadError(true);
      return {success:false,error:{code:ErrorCode.INTERNAL_ERROR,message:"竞猜数据更新失败，请刷新后查看。"}};
    } finally { if (inFlight.current === request) inFlight.current = null; }
  }
  useVisiblePolling(async () => { await refresh(false); },15000);
  async function refreshPanel(model: FreePredictionModel) {
    const result = await refresh();
    if (!result.success) return result;
    const match = result.data.free.matches.find(row => row.matchId === model.matchId);
    if (!match) return { success: false as const, error: { code: ErrorCode.NOT_FOUND, message: "比赛预测暂不可用，请刷新页面。" } };
    return { success: true as const, data: freePredictionPanel(match, model.kind) };
  }
  return <>
    {readError && <p role="status" className="mb-3 text-sm text-[var(--color-warn)]">预测状态更新失败，请刷新后查看。</p>}
    <BetBoard {...props} initial={bet} refreshAction={async()=> (await refresh()).success} rankingRefreshAction={async sort => {
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
