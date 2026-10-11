import { db } from "@/db/client";
import { readMatchSupport } from "@/lib/bet/match-support";
import { MatchSupport, type MatchSupportTeam } from "./MatchSupport";

export async function MatchBetLink({ seasonId, matchId, slug, teamA, teamB }: {
  seasonId: string;
  matchId: string;
  slug: string;
  teamA: MatchSupportTeam;
  teamB: MatchSupportTeam;
}) {
  const amounts = await readMatchSupport(db, seasonId, matchId);
  if (!amounts) return null;
  return <MatchSupport slug={slug} matchId={matchId} teamA={teamA} teamB={teamB} amounts={amounts} />;
}
