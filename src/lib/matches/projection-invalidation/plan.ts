import { publicBetTag } from "@/lib/cache/tags";

/** Conservative for unknown or historical facts, preserving warm statistics otherwise. */
export function planMatchProjectionInvalidation(context: { seasonId: string; matchStatus: string }, facts?: readonly string[], forceStatistics = false) {
  const nonHistorical = (context.matchStatus === "scheduled" || context.matchStatus === "in_progress")
    && Array.isArray(facts) && facts.length > 0 && facts.every(fact => ["lineups", "appeals", "veto_step"].includes(fact));
  return { statistics: !nonHistorical || forceStatistics, immediateTag: publicBetTag(context.seasonId) };
}
