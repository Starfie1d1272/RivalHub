import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matchLiveSessions, matchVetoSessions, matchMaps, type Match, type MatchMap } from "@/db/schema";
import { computeSeriesScoreAfterMap } from "./result-rules";
import { canConfirmMapScoreboard } from "./map-scoreboard";
import type { PublicMatchContext } from "./public-context";
import { LINEUP_REVIEW_REQUIRED } from "@/lib/mizar/lineup-display";
import { projectMatchPresentationPhase, resolveGameplayMapId } from "./presentation-phase";

/** Called after the public route has checked match/season visibility. No private DTO escapes. */
export async function loadPublicMatchPhase(match: Match, maps: MatchMap[]) {
  if (match.status === "finished" || match.status === "cancelled") {
    return projectPublicContext(match, maps, undefined, undefined);
  }
  const [veto, session] = await Promise.all([
    db.query.matchVetoSessions.findFirst({ where: eq(matchVetoSessions.matchId, match.id), columns: { startedAt: true, completedAt: true } }),
    db.query.matchLiveSessions.findFirst({ where: and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt)), columns: { currentMapId: true, mapExecutionPhase: true, lineupHealth: true } }),
  ]);
  return projectPublicContext(match, maps, veto, session);
}

type PhaseMatch = Pick<Match, "id" | "status" | "scheduledAt" | "startedAt" | "completedAt" | "format">;
type PhaseMap = Pick<MatchMap, "id" | "mapName" | "mapOrder" | "scoreA" | "scoreB" | "completedAt" | "startedAt">;
function projectPublicContext(match: PhaseMatch, maps: PhaseMap[], veto: { startedAt: Date | null; completedAt: Date | null } | undefined, session: { currentMapId: string | null; mapExecutionPhase: string; lineupHealth: string } | undefined): PublicMatchContext {
  const facts = {
    status: match.status, scheduledAt: match.scheduledAt?.toISOString() ?? null,
    startedAt: match.startedAt?.toISOString() ?? null, completedAt: match.completedAt?.toISOString() ?? null,
    veto: veto?.completedAt || (maps.length > 0 && !veto?.startedAt) ? "completed" as const : veto?.startedAt ? "in_progress" as const : "not_started" as const,
    maps: maps.map(map => ({ id: map.id, order: map.mapOrder, completedAt: canConfirmMapScoreboard(map) ? map.completedAt!.toISOString() : null })),
    gameplayMapId: resolveGameplayMapId(maps, session),
  };
  const displayMapId = match.status === "in_progress" && session?.lineupHealth === LINEUP_REVIEW_REQUIRED && maps.some(map => map.id === session.currentMapId && !map.completedAt) ? session.currentMapId : null;
  const currentMapId = displayMapId ?? [...facts.maps].sort((a, b) => a.order - b.order).find(map => map.completedAt === null)?.id ?? null;
  const confirmed = maps.filter(canConfirmMapScoreboard).sort((a, b) => a.mapOrder - b.mapOrder);
  const last = confirmed.at(-1);
  const progress = match.status === "in_progress" && last
    ? computeSeriesScoreAfterMap(match.format, confirmed.slice(0, -1), last.scoreA!, last.scoreB!) : null;
  return { phase: displayMapId ? session?.mapExecutionPhase === "gameplay" ? "gameplay" : session?.mapExecutionPhase === "inter_map" ? "inter_map" : "awaiting_gameplay" : projectMatchPresentationPhase(facts), currentMapId,
    lastCompletedMap: last ? { id: last.id, mapName: last.mapName, scoreA: last.scoreA!, scoreB: last.scoreB! } : null,
    seriesProgress: progress ? { scoreA: progress.mapWinsA, scoreB: progress.mapWinsB } : null };

}

/** Batch canonical context for visible public schedule consumers; never query per card. */
export async function loadPublicMatchContexts(matches: readonly PhaseMatch[]): Promise<Map<string, PublicMatchContext>> {
  const active = matches.filter(match => match.status === "in_progress");
  if (!active.length) return new Map();
  const ids = active.map(match => match.id);
  const [maps, vetos, sessions] = await Promise.all([
    db.query.matchMaps.findMany({ where: inArray(matchMaps.matchId, ids), columns: { matchId: true, id: true, mapName: true, mapOrder: true, scoreA: true, scoreB: true, startedAt: true, completedAt: true } }),
    db.query.matchVetoSessions.findMany({ where: inArray(matchVetoSessions.matchId, ids), columns: { matchId: true, startedAt: true, completedAt: true } }),
    db.query.matchLiveSessions.findMany({ where: and(inArray(matchLiveSessions.matchId, ids), isNull(matchLiveSessions.closedAt)), columns: { matchId: true, currentMapId: true, mapExecutionPhase: true, lineupHealth: true } }),
  ]);
  return new Map(active.map(match => [match.id, projectPublicContext(match, maps.filter(map => map.matchId === match.id), vetos.find(veto => veto.matchId === match.id), sessions.find(session => session.matchId === match.id))]));
}
