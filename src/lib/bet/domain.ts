import type { BetSubject, MarketType } from "./types";
import type { MarketResolutionFact } from "./resolution";
export interface MatchFact {
  id: string; entryAId: string; entryBId: string; majorStageRunId: string | null; qualificationRunId: string | null;
  format: "bo1" | "bo3" | "bo5"; status: "scheduled" | "in_progress" | "finished" | "cancelled";
  isForfeit: boolean; startedAt: Date | null; scoreA: number | null; scoreB: number | null;
}
export interface MapFact { id: string; matchId: string; mapOrder: number; mapName: string; startedAt: Date | null; completedAt: Date | null; scoreA: number | null; scoreB: number | null }
export interface VetoFact { startedAt: Date | null; completedAt: Date | null; mapPoolSnapshot: string[] | null; pendingAppeal: boolean }
export interface EventFact { entryIds: string[]; playerIds: string[]; started: boolean; champion: string | null; kills: { userId: string; kills: number }[] | null }
export interface MarketFactInput { type: MarketType; subject: BetSubject; line: number | null; voidedAt: Date | null; match?: MatchFact; maps: MapFact[]; veto?: VetoFact; event: EventFact }
export function sameIds(a: readonly string[],b: readonly string[]) { return [...a].sort().join(",") === [...b].sort().join(","); }
export function subjectMatches(subject: BetSubject,match: MatchFact | undefined, maps: MapFact[],veto?: VetoFact): boolean {
  if (subject.kind === "event") return true;
  if (!match || subject.entryIds[0] !== match.entryAId || subject.entryIds[1] !== match.entryBId || subject.runId !== (match.majorStageRunId ?? match.qualificationRunId) || subject.format !== match.format) return false;
  if (subject.kind === "map") return maps.some(m=>m.id===subject.mapId && m.mapName===subject.mapName && m.mapOrder===subject.mapOrder);
  if (subject.mapPool.length && veto?.mapPoolSnapshot && !sameIds(subject.mapPool,veto.mapPoolSnapshot)) return false;
  return true;
}
export function marketIsLocked(input: MarketFactInput): boolean {
  if (input.voidedAt || !subjectMatches(input.subject,input.match,input.maps,input.veto)) return true;
  if (input.subject.kind === "event") return input.event.started || !sameIds(input.subject.entryIds,input.event.entryIds) || (input.type === "top_fragger" && !sameIds(input.subject.playerIds,input.event.playerIds));
  const match = input.match!;
  if (match.isForfeit || ["finished","cancelled"].includes(match.status)) return true;
  if (input.type.startsWith("veto_")) return !!input.veto?.startedAt || !!match.startedAt || match.status === "finished";
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
  if (input.type.startsWith("veto_")) {
    if (!input.veto?.completedAt || input.veto.pendingAppeal) return pending;
    const order = input.type === "veto_decider" ? Number(match.format.slice(2)) : 1;
    const map = input.maps.find(m=>m.mapOrder===order);
    return map ? confirmed([map.mapName],{order,name:map.mapName}) : pending;
  }
  if (input.subject.kind === "map") {
    const id = input.subject.mapId;
    const map = input.maps.find(m=>m.id===id);
    if (!map?.completedAt || map.scoreA === null || map.scoreB === null || map.scoreA === map.scoreB) return match.status === "finished" ? voidFact : pending;
    return input.type === "map_winner"
      ? confirmed([map.scoreA > map.scoreB ? match.entryAId : match.entryBId],{a:map.scoreA,b:map.scoreB})
      : confirmed([(map.scoreA+map.scoreB)*2 > input.line! ? "over":"under"],{a:map.scoreA,b:map.scoreB});
  }
  if (match.status !== "finished" || match.scoreA === null || match.scoreB === null || match.scoreA === match.scoreB) return pending;
  const fact = {a:match.scoreA,b:match.scoreB};
  if (input.type === "match_winner") return confirmed([match.scoreA > match.scoreB ? match.entryAId : match.entryBId],fact);
  if (input.type === "exact_score") return confirmed([`${match.scoreA}:${match.scoreB}`],fact);
  return confirmed([(match.scoreA+match.scoreB)*2 > input.line! ? "over":"under"],fact);
}
