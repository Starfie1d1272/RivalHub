import "server-only";

import { sql } from "drizzle-orm";
import { buildTournamentPerformanceAnalyticsFromProjections } from "@cs2dak/tournament";
import { db, type DB } from "@/db/client";
import { matchDemoStatProjections } from "@/db/schema";
import { loadMatchRoundSegments } from "@/lib/matches/round-segments-query";
import { loadStatsContext } from "./tournament-scope";
import { loadStatsEvidenceSelection, type PlayerDetailFacts } from "./tournament-projections";

/** One bounded match snapshot feeds both teams, every side and individual drill-downs. */
export async function getMatchPerformance(matchId: string, database: DB = db) {
  const { loaded, roundSegments } = await database.transaction(
    async (tx) => {
      const options = { matchIds: [matchId], includeTestMatch: true, skipLabels: true };
      const context = await loadStatsContext(tx, {}, options);
      const roundSegments = await loadMatchRoundSegments(tx, context.currentRefs);
      const loaded = await loadStatsEvidenceSelection(
        tx,
        {},
        options,
        sql<PlayerDetailFacts>`jsonb_build_object('tournament', jsonb_build_object(
      'mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey',
      'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey',
      'mapName', ${matchDemoStatProjections.facts}->'tournament'->'mapName'
    ))`,
        true,
        false,
        context,
      );
      return { loaded, roundSegments };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const aggregate = (rows: typeof loaded.selected) =>
    buildTournamentPerformanceAnalyticsFromProjections(
      rows.map((row) => row.facts.performance),
      { labels: loaded.labels },
    ).players;
  return {
    roundSegments,
    overall: aggregate(loaded.selected),
    byMap: Object.fromEntries(
      loaded.selected.map((row) => [row.facts.performance.mapKey, aggregate([row])]),
    ),
    currentImports: Object.fromEntries(
      loaded.selected.map((row) => [row.facts.performance.mapKey, row.importId]),
    ),
  };
}

export type MatchPerformance = Awaited<ReturnType<typeof getMatchPerformance>>;
