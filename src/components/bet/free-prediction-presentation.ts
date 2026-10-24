import type { BetBoardDTO } from "@/lib/bet/types";
import type { FreePredictionMatchDTO, FreePredictionRankingRowDTO } from "@/lib/free-predictions/types";
import { mapLabel } from "@/lib/maps";
import type { FreePredictionModel, PredictionRankingModel } from "./presentation-contract";

export function freeMatchRow(match: FreePredictionMatchDTO): BetBoardDTO["matches"][number] {
  return { id: match.matchId, entryAId: match.entryIds[0], entryBId: match.entryIds[1], a: match.a, b: match.b, logoA: match.logoA, logoB: match.logoB, stage: match.stage, format: match.format.toUpperCase(), scheduledAt: match.scheduledAt, status: match.status, displayScore: match.displayScore };
}

export function freePredictionPanel(match: FreePredictionMatchDTO, kind: "winner" | "bp"): FreePredictionModel {
  const panel = kind === "winner" ? match.result : match.bp;
  const grade = panel.grade;
  return {
    matchId: match.matchId, officialStatus: match.status, kind,
    requiredChoices: kind === "winner" ? 1 : Number(match.format.slice(2)),
    options: kind === "winner"
      ? match.entryIds.map((key, index) => ({ key, label: index === 0 ? match.a : match.b, count: match.result.support.counts[index]! }))
      : match.mapPool.map(key => ({ key, label: mapLabel(key), count: null })),
    own: kind === "winner" ? match.result.mine ? [match.result.mine] : [] : match.bp.mine ?? [],
    participants: panel.support.total, canSubmit: panel.canSubmit,
    status: match.status === "cancelled" || match.isForfeit || grade?.state === "void" ? "void" : grade && ["correct", "incorrect"].includes(grade.state) ? "judged" : panel.locked ? "locked" : !panel.canSubmit && panel.restriction?.code !== "sign_in" ? "unavailable" : "open",
    reason: panel.restriction?.message ?? null,
    result: grade && (grade.state === "correct" || grade.state === "incorrect") ? { hit: grade.state === "correct", matched: grade.hits ?? 0, total: grade.total, answer: grade.answer ?? [] } : null,
  };
}

export function freeRankingModel(data: { rows: FreePredictionRankingRowDTO[]; dynamicFloor: { floor: number } | null }): PredictionRankingModel {
  return { rows: data.rows.map(row => ({ ...row, decided: row.judged })), rankedCount: data.rows.filter(row => row.group === "ranked").length, floor: data.dynamicFloor?.floor ?? null };
}
