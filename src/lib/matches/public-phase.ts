import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { matchLiveSessions, matchVetoSessions, type Match, type MatchMap } from "@/db/schema";
import { computeSeriesScoreAfterMap } from "./result-rules";
import { canConfirmMapScoreboard } from "./map-scoreboard";
import { projectMatchPresentationPhase } from "./presentation-phase";

/** Called after the public route has checked match/season visibility. No private DTO escapes. */
export async function loadPublicMatchPhase(match: Match, maps: MatchMap[]) {
  const [veto, session] = await Promise.all([
    db.query.matchVetoSessions.findFirst({ where: eq(matchVetoSessions.matchId, match.id), columns: { startedAt: true, completedAt: true } }),
    db.query.matchLiveSessions.findFirst({ where: and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt)), columns: { currentMapId: true, mapExecutionPhase: true } }),
  ]);
  const facts = {
    status: match.status, scheduledAt: match.scheduledAt?.toISOString() ?? null,
    startedAt: match.startedAt?.toISOString() ?? null, completedAt: match.completedAt?.toISOString() ?? null,
    veto: veto?.completedAt || (maps.length > 0 && !veto?.startedAt) ? "completed" as const : veto?.startedAt ? "in_progress" as const : "not_started" as const,
    maps: maps.map(map => ({ id: map.id, order: map.mapOrder, completedAt: canConfirmMapScoreboard(map) ? map.completedAt!.toISOString() : null })),
    gameplayMapId: session?.mapExecutionPhase === "gameplay" ? session.currentMapId : null,
  };
  const currentMapId = [...facts.maps].sort((a, b) => a.order - b.order).find(map => map.completedAt === null)?.id ?? null;
  const confirmed = maps.filter(canConfirmMapScoreboard);
  const last = confirmed.at(-1);
  const progress = match.status === "in_progress" && last
    ? computeSeriesScoreAfterMap(match.format, confirmed.slice(0, -1), last.scoreA!, last.scoreB!) : null;
  return { phase: projectMatchPresentationPhase(facts), currentMapId,
    seriesProgress: progress ? { scoreA: progress.mapWinsA, scoreB: progress.mapWinsB } : null };

}
