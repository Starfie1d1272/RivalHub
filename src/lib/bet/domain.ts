import { sameIds, matchSubjectMatches, matchPredictionLocked, matchWinner, type MatchFact, type MapFact, type VetoFact } from "@/lib/matches/spectator-facts";
import { completedVetoMaps } from "@/lib/matches/veto-result";
import { computeSeriesProgress } from "@/lib/matches/result-rules";
import type { BetSubject, MarketType } from "./types";
import type { MarketResolutionFact } from "./resolution";
export interface EventFact { entryIds: string[]; playerIds: string[]; started: boolean; champion: string | null; kills: { userId: string; kills: number }[] | null }
export interface MarketFactInput { type: MarketType; subject: BetSubject; line: number | null; voidedAt: Date | null; match?: MatchFact; maps: MapFact[]; veto?: VetoFact; event: EventFact }
export function subjectMatches(subject: BetSubject,match: Pick<MatchFact, "entryAId" | "entryBId" | "majorStageRunId" | "qualificationRunId" | "format"> | undefined, maps: Pick<MapFact, "id" | "mapName" | "mapOrder">[],veto?: Pick<VetoFact, "mapPoolSnapshot">): boolean {
  if (subject.kind === "event") return true;
  if (!matchSubjectMatches(subject,match,subject.kind === "match" ? veto : undefined)) return false;
  if (subject.kind === "map") return maps.some(m=>m.id===subject.mapId && m.mapName===subject.mapName && m.mapOrder===subject.mapOrder);
  if (subject.kind === "map_slot") return Number.isInteger(subject.mapOrder) && subject.mapOrder >= 1 && subject.mapOrder <= Number(subject.format.slice(2));
  if (subject.kind !== "match") return false;
  return true;
}
export function marketIsLocked(input: MarketFactInput): boolean {
  if (input.voidedAt || !subjectMatches(input.subject,input.match,input.maps,input.veto)) return true;
  if (input.subject.kind === "event") return input.event.started || !sameIds(input.subject.entryIds,input.event.entryIds) || (input.type === "top_fragger" && !sameIds(input.subject.playerIds,input.event.playerIds));
  const match = input.match!;
  if (input.subject.kind === "match") return matchPredictionLocked(input.subject,match,input.veto,input.type.startsWith("veto_"));
  if (match.isForfeit || ["finished","cancelled"].includes(match.status)) return true;
  if (input.type.startsWith("veto_")) return !!input.veto?.startedAt || !!match.startedAt;
  if ((input.subject.kind === "map" || input.subject.kind === "map_slot") && computeSeriesProgress(match.format,input.maps.filter(m=>m.completedAt)).seriesFinished) return true;
  if (input.subject.kind === "map_slot") {
    const order = input.subject.mapOrder;
    return input.maps.some(m=>m.mapOrder >= order && (m.startedAt || m.completedAt)) || (order === 1 && !!match.startedAt);
  }
  if (input.subject.kind === "map") {
    const id = input.subject.mapId;
    const selected = input.maps.find(m=>m.id===id);
    return !!selected?.startedAt || !!selected?.completedAt || (input.subject.mapOrder === 1 && (match.status === "finished" || !!match.startedAt));
  }
  return !!match.startedAt;
}
export function resolveBetFact(input: MarketFactInput): MarketResolutionFact {
  const pending: MarketResolutionFact = { state:"pending",revision:"pending" };
  const voidFact: MarketResolutionFact = { state:"void",revision:"void" };
  const confirmed = (winningKeys: string[], fact: unknown): MarketResolutionFact => ({state:"confirmed",winningKeys,revision:JSON.stringify(fact)});
  if (input.voidedAt || !subjectMatches(input.subject,input.match,input.maps,input.veto)) return voidFact;
  if (input.subject.kind === "event") {
    if (!sameIds(input.subject.entryIds,input.event.entryIds) || (input.type === "top_fragger" && !sameIds(input.subject.playerIds,input.event.playerIds))) return voidFact;
    if (!input.event.champion) return pending;
    if (input.type === "champion") return confirmed([input.event.champion],input.event.champion);
    if (!input.event.kills?.length) return pending;
    const max = Math.max(...input.event.kills.map(p=>p.kills));
    return confirmed(input.event.kills.filter(p=>p.kills===max).map(p=>p.userId),input.event.kills);
  }
  const match = input.match!;
  if (match.isForfeit || match.status === "cancelled") return voidFact;
  if (input.type === "veto_present") {
    // The frozen pool and BO define this market's terms; never infer them from play count.
    if (input.subject.kind !== "match" || match.format !== "bo3" ||
      input.subject.mapPool.length !== 7 || new Set(input.subject.mapPool).size !== 7) return voidFact;
    const names = completedVetoMaps(match.format, match.entryAId, input.veto);
    return names ? confirmed([...names].sort(), [...names].sort()) : pending;
  }
  if (input.type.startsWith("veto_")) {
    const names = completedVetoMaps(match.format, match.entryAId, input.veto);
    if (!names) return pending;
    const order = input.type === "veto_decider" ? Number(match.format.slice(2)) : 1;
    const name = names[order-1]!;
    return confirmed([name],{order,name});
  }
  if (input.subject.kind === "map" || input.subject.kind === "map_slot") {
    const subject = input.subject;
    const map = subject.kind === "map" ? input.maps.find(m=>m.id===subject.mapId) : input.maps.find(m=>m.mapOrder===subject.mapOrder);
    if (!map?.completedAt || map.scoreA === null || map.scoreB === null || map.scoreA === map.scoreB) return match.status === "finished" ? voidFact : pending;
    return input.type === "map_winner"
      ? confirmed([map.scoreA > map.scoreB ? match.entryAId : match.entryBId],{a:map.scoreA,b:map.scoreB})
      : confirmed([(map.scoreA+map.scoreB)*2 > input.line! ? "over":"under"],{a:map.scoreA,b:map.scoreB});
  }
  if (match.status !== "finished" || match.scoreA === null || match.scoreB === null || match.scoreA === match.scoreB) return pending;
  const fact = {a:match.scoreA,b:match.scoreB};
  if (input.type === "match_winner") return confirmed([matchWinner(match)!],fact);
  if (input.type === "exact_score") return confirmed([`${match.scoreA}:${match.scoreB}`],fact);
  return confirmed([(match.scoreA+match.scoreB)*2 > input.line! ? "over":"under"],fact);
}
