import { sameIds, subjectMatches, resolveBetFact, type MarketFactInput } from "@/lib/bet/domain";
import type { FreePredictionKind, FreePredictionSubject, FreePredictionResultDTO } from "./types";
export function predictionInput(subject: FreePredictionSubject, input: Omit<MarketFactInput, "type" | "subject" | "line" | "voidedAt">): MarketFactInput {
  return { ...input, type: "match_winner", subject: { ...subject, kind: "match" }, line: null, voidedAt: null };
}
export function gradePrediction(kind: FreePredictionKind, selection: string[], input: MarketFactInput): FreePredictionResultDTO {
  const total = kind === "result" ? 1 : Number(input.match?.format.slice(2) ?? (input.subject.kind === "event" ? "1" : input.subject.format.slice(2)));
  const pending: FreePredictionResultDTO = { state: "pending", hits: null, total, answer: null };
  const voided: FreePredictionResultDTO = { ...pending, state: "void" };
  if (!subjectMatches(input.subject, input.match, input.maps, input.veto) || input.match?.isForfeit || input.match?.status === "cancelled") return voided;
  if (kind === "result") {
    const fact = resolveBetFact(input);
    if (fact.state === "void") return voided;
    if (fact.state !== "confirmed") return pending;
    const hits = fact.winningKeys.includes(selection[0]!) ? 1 : 0;
    return { state: hits ? "correct" : "incorrect", hits, total: 1, answer: [...fact.winningKeys] };
  }
  if (!input.veto?.completedAt || input.veto.pendingAppeal) return pending;
  const maps = input.maps.filter(m => m.mapOrder >= 1 && m.mapOrder <= total).sort((a,b) => a.mapOrder-b.mapOrder);
  const answer = maps.map(m => m.mapName);
  if (maps.length !== total || new Set(answer).size !== total || maps.some((m,i) => m.mapOrder !== i+1) || !answer.every(name => input.veto!.mapPoolSnapshot?.includes(name))) return voided;
  const hits = selection.filter(name => answer.includes(name)).length;
  return { state: sameIds(selection, answer) ? "correct" : "incorrect", hits, total, answer };
}
