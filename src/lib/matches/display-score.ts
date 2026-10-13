import { isMatchFormat } from "@/types/match";
import { isValidCS2RoundScore, validateSeriesScore } from "./result-rules";

export type DisplayScore = { scoreA: number | null; scoreB: number | null; kind: "rounds" | "series" };
export type DisplayScoreMatch = {
  format: string; status: string; isForfeit?: boolean; resultDisposition?: string | null;
  scoreA: number | null; scoreB: number | null;
};
export type DisplayScoreMap = {
  mapOrder: number; scoreA: number | null; scoreB: number | null; completedAt: Date | string | null;
};

/** Presentation only: official series facts remain the outcome/settlement authority. */
export function projectDisplayScore(match: DisplayScoreMatch, maps: readonly DisplayScoreMap[] = []): DisplayScore {
  const finished = match.status === "finished" && (!match.resultDisposition || match.resultDisposition === "recorded");
  let validSeries = false;
  if (finished && isMatchFormat(match.format) && match.scoreA !== null && match.scoreB !== null) {
    try { validateSeriesScore(match.format, match.scoreA, match.scoreB); validSeries = true; } catch { /* Unknown/invalid results stay unscored. */ }
  }
  const series: DisplayScore = { scoreA: validSeries ? match.scoreA : null, scoreB: validSeries ? match.scoreB : null, kind: "series" };
  if (!validSeries || match.format !== "bo1" || match.isForfeit || maps.length !== 1 ||
    Math.max(match.scoreA ?? -1, match.scoreB ?? -1) !== 1 || Math.min(match.scoreA ?? -1, match.scoreB ?? -1) !== 0) return series;
  const map = maps[0];
  const { scoreA: a, scoreB: b } = map;
  if (map.mapOrder !== 1 || !map.completedAt || a === null || b === null ||
    !Number.isInteger(a) || !Number.isInteger(b) || !isValidCS2RoundScore(Math.max(a, b), Math.min(a, b)) ||
    (a > b) !== (match.scoreA! > match.scoreB!)) return series;
  return { scoreA: a, scoreB: b, kind: "rounds" };
}
