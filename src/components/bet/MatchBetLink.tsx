import { db } from "@/db/client";
import { readFreeMatchSupport } from "@/lib/free-predictions/data";
import { readMatchSupport } from "@/lib/bet/match-support";
import { MatchSupport, type MatchSupportTeam } from "./MatchSupport";

export async function MatchBetLink({ seasonId, matchId, slug, teamA, teamB }: {
  seasonId: string;
  matchId: string;
  slug: string;
  teamA: MatchSupportTeam;
  teamB: MatchSupportTeam;
}) {
  const support = await db.transaction(async tx => {
    const amounts = await readMatchSupport(tx, seasonId, matchId);
    const predictions = await readFreeMatchSupport(tx, seasonId, matchId);
    return { amounts, predictions };
  }, { accessMode: "read only", isolationLevel: "repeatable read" });
  if (!support.amounts && !support.predictions) return null;
  return <MatchSupport slug={slug} matchId={matchId} teamA={teamA} teamB={teamB} amounts={support.amounts ?? []} predictions={support.predictions ? [{ entryId: teamA.entryId, count: support.predictions.counts[0] }, { entryId: teamB.entryId, count: support.predictions.counts[1] }] : undefined} />;
}
