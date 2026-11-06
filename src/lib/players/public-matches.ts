import "server-only";

import { and, asc, desc, eq, exists, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cacheLife, cacheTag } from "next/cache";
import { db, type DB, type TxDb } from "@/db/client";
import {
  competitionEntries,
  matchMaps,
  matchPlayerStats,
  matchRosters,
  matches,
  seasons,
} from "@/db/schema";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { preservePublicStatsDependencyFailure } from "@/lib/stats/availability";
import { loadCurrentProjectionRefs, loadStatsContext } from "@/lib/stats/tournament-scope";
import { publicPlayerAppearancesQuery } from "./public-record";
import { parsePlayerMatchesCursor, type PlayerMatchesQuery } from "./matches-view-state";

export const PLAYER_MATCHES_PAGE_SIZE = 20;
const CANDIDATE_BATCH_SIZE = PLAYER_MATCHES_PAGE_SIZE + 1;
const playedAt = sql<Date | null>`coalesce(${matches.completedAt}, ${matches.scheduledAt})`;
const entryA = alias(competitionEntries, "player_history_entry_a");
const entryB = alias(competitionEntries, "player_history_entry_b");

export interface PublicPlayerMatchMap {
  id: string;
  name: string;
  order: number;
  ownScore: number;
  opponentScore: number;
  kills: number | null;
  deaths: number | null;
  adr: number | null;
  rating: number | null;
}

export interface PublicPlayerMatch {
  id: string;
  seasonSlug: string;
  seasonName: string;
  date: string | null;
  cursor: string;
  teamName: string;
  opponentName: string;
  ownScore: number | null;
  opponentScore: number | null;
  result: "win" | "loss" | "unknown";
  isForfeit: boolean;
  maps: PublicPlayerMatchMap[];
  completedMaps: number;
  confirmedMaps: number;
}

function cursorCondition(
  cursor: string,
  direction: PlayerMatchesQuery["direction"],
): SQL | undefined {
  const point = parsePlayerMatchesCursor(cursor);
  if (!point) return undefined;
  if (direction === "newer")
    return point.date
      ? sql`(${playedAt} > ${point.date}::timestamptz OR (${playedAt} = ${point.date}::timestamptz AND ${matches.id} > ${point.matchId}::uuid))`
      : sql`(${playedAt} IS NOT NULL OR (${playedAt} IS NULL AND ${matches.id} > ${point.matchId}::uuid))`;
  return point.date
    ? sql`(${playedAt} < ${point.date}::timestamptz OR ${playedAt} IS NULL OR (${playedAt} = ${point.date}::timestamptz AND ${matches.id} < ${point.matchId}::uuid))`
    : sql`(${playedAt} IS NULL AND ${matches.id} < ${point.matchId}::uuid)`;
}

interface Candidate {
  id: string;
  seasonSlug: string;
  seasonName: string;
  entryId: string;
  entryAId: string | null;
  entryBId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  isForfeit: boolean;
  date: string | null;
  teamAName: string;
  teamBName: string;
}

function candidateMatches(
  database: DB | TxDb,
  userId: string,
  query: PlayerMatchesQuery,
  limit: number,
): Promise<Candidate[]> {
  // This SQL is a cheap candidate filter, not final DAK eligibility. The latter
  // is validated in the canonical owner before a series can consume a page slot.
  const matchingMap = query.map
    ? exists(
        database
          .select({ id: matchPlayerStats.id })
          .from(matchPlayerStats)
          .innerJoin(
            matchMaps,
            and(
              eq(matchMaps.id, matchPlayerStats.mapId),
              eq(matchMaps.matchId, matchPlayerStats.matchId),
            ),
          )
          .where(
            and(
              eq(matchPlayerStats.matchId, matches.id),
              eq(matchPlayerStats.userId, userId),
              isNotNull(matchPlayerStats.verifiedByAdmin),
              eq(matchMaps.mapName, query.map),
              isNotNull(matchMaps.completedAt),
              sql`${matchMaps.scoreA} + ${matchMaps.scoreB} > 0`,
            ),
          ),
      )
    : undefined;
  const appearances = publicPlayerAppearancesQuery(
    database,
    userId,
    {
      id: matches.id,
      seasonSlug: seasons.slug,
      seasonName: seasons.name,
      entryId: matchRosters.entryId,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
      isForfeit: matches.isForfeit,
      // PostgreSQL microseconds must survive keyset navigation; a JS Date would truncate them.
      date: sql<
        string | null
      >`to_char(${playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("played_at"),
    },
    and(
      query.event ? eq(seasons.slug, query.event) : undefined,
      matchingMap,
      cursorCondition(query.cursor, query.direction),
    ),
  ).as("player_appearances");
  return database
    .select({
      id: appearances.id,
      seasonSlug: appearances.seasonSlug,
      seasonName: appearances.seasonName,
      entryId: appearances.entryId,
      entryAId: appearances.entryAId,
      entryBId: appearances.entryBId,
      scoreA: appearances.scoreA,
      scoreB: appearances.scoreB,
      isForfeit: appearances.isForfeit,
      date: appearances.date,
      teamAName: entryA.name,
      teamBName: entryB.name,
    })
    .from(appearances)
    .innerJoin(entryA, eq(entryA.id, appearances.entryAId))
    .innerJoin(entryB, eq(entryB.id, appearances.entryBId))
    .orderBy(
      query.direction === "newer"
        ? sql`${appearances.date} ASC NULLS FIRST`
        : sql`${appearances.date} DESC NULLS LAST`,
      query.direction === "newer" ? asc(appearances.id) : desc(appearances.id),
    )
    .limit(limit)
    .execute();
}

function presentMatch(row: Candidate): PublicPlayerMatch {
  const isA = row.entryId === row.entryAId;
  const ownScore = isA ? row.scoreA : row.scoreB;
  const opponentScore = isA ? row.scoreB : row.scoreA;
  const date = row.date;
  return {
    id: row.id,
    seasonSlug: row.seasonSlug,
    seasonName: row.seasonName,
    date,
    cursor: `${date ?? "none"}|${row.id}`,
    teamName: isA ? row.teamAName : row.teamBName,
    opponentName: isA ? row.teamBName : row.teamAName,
    ownScore,
    opponentScore,
    result:
      ownScore === null || opponentScore === null || ownScore === opponentScore
        ? "unknown"
        : ownScore > opponentScore
          ? "win"
          : "loss",
    isForfeit: row.isForfeit,
    maps: [],
    completedMaps: 0,
    confirmedMaps: 0,
  };
}

async function loadPersonalMaps(tx: TxDb, userId: string, candidates: Candidate[]) {
  if (!candidates.length) return [];
  const matchIds = candidates.map((row) => row.id);
  const rows = await tx
    .select({
      matchId: matchMaps.matchId,
      id: matchMaps.id,
      name: matchMaps.mapName,
      order: matchMaps.mapOrder,
      scoreA: matchMaps.scoreA,
      scoreB: matchMaps.scoreB,
      statId: matchPlayerStats.id,
      importId: matchPlayerStats.dakImportId,
      kills: matchPlayerStats.kills,
      deaths: matchPlayerStats.deaths,
      adr: matchPlayerStats.adr,
      rating: matchPlayerStats.ratingPro,
    })
    .from(matchMaps)
    .leftJoin(
      matchPlayerStats,
      and(
        eq(matchPlayerStats.mapId, matchMaps.id),
        eq(matchPlayerStats.matchId, matchMaps.matchId),
        eq(matchPlayerStats.userId, userId),
        isNotNull(matchPlayerStats.verifiedByAdmin),
      ),
    )
    .where(
      and(
        inArray(matchMaps.matchId, matchIds),
        isNotNull(matchMaps.completedAt),
        sql`${matchMaps.scoreA} + ${matchMaps.scoreB} > 0`,
      ),
    )
    .orderBy(asc(matchMaps.mapOrder), asc(matchMaps.id));
  const dakMatchIds = [...new Set(rows.filter((row) => row.importId).map((row) => row.matchId))];
  const refs = dakMatchIds.length
    ? await loadCurrentProjectionRefs(
        tx,
        await loadStatsContext(tx, {}, { matchIds: dakMatchIds, skipLabels: true }),
      )
    : [];
  const validImports = new Map(
    refs
      .filter(({ projection }) =>
        projection.identityBindings.some((binding) => binding.userId === userId),
      )
      .map(({ current, map }) => [map.id, current.id]),
  );
  return candidates.map((candidate) => {
    const result = presentMatch(candidate);
    const mapRows = rows.filter((row) => row.matchId === candidate.id);
    result.completedMaps = new Set(mapRows.map((row) => row.id)).size;
    // Multiple names bound to one person are ambiguous, even if each row was
    // approved. Never count twice or select an arbitrary nickname's statistics.
    for (const mapId of new Set(mapRows.map((row) => row.id))) {
      const personal = mapRows.filter(
        (row) =>
          row.id === mapId &&
          row.statId &&
          (!row.importId || validImports.get(row.id) === row.importId),
      );
      if (personal.length !== 1) continue;
      const row = personal[0];
      if (row.scoreA === null || row.scoreB === null) continue;
      result.maps.push({
        id: row.id,
        name: row.name,
        order: row.order,
        ownScore: candidate.entryId === candidate.entryAId ? row.scoreA : row.scoreB,
        opponentScore: candidate.entryId === candidate.entryAId ? row.scoreB : row.scoreA,
        kills: row.kills,
        deaths: row.deaths,
        adr: row.adr,
        rating: row.rating,
      });
    }
    result.confirmedMaps = result.maps.length;
    return result;
  });
}

/** Identity has been checked live by the public profile/record entrypoint. */
export async function getRecentPublicPlayerMatches(userId: string) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  return preservePublicStatsDependencyFailure(async () =>
    (
      await candidateMatches(
        db,
        userId,
        { event: "", map: "", page: 1, cursor: "", direction: "older" },
        5,
      )
    ).map(presentMatch),
  );
}

export async function getPublicPlayerMatchFilters(userId: string) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  return preservePublicStatsDependencyFailure(async () =>
    (
      await publicPlayerAppearancesQuery(db, userId, {
        id: seasons.id,
        slug: seasons.slug,
        name: seasons.name,
      }).orderBy(asc(seasons.name), asc(seasons.id))
    ).map(({ id, slug, name }) => ({ id, slug, name })),
  );
}

export async function getPublicPlayerMatches(userId: string, query: PlayerMatchesQuery) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  return preservePublicStatsDependencyFailure(() =>
    db.transaction(
      async (tx) => {
        const selected: PublicPlayerMatch[] = [];
        let cursor = query.cursor;
        let exhausted = false;
        // Fetch only compact candidate metadata and this user's verified scoreboard
        // rows. No career projection, raw evidence, ten-player detail or N+1 reads.
        // Invalid DAK candidates are discarded BEFORE counting page slots.
        while (selected.length <= PLAYER_MATCHES_PAGE_SIZE && !exhausted) {
          const candidates = await candidateMatches(
            tx,
            userId,
            { ...query, cursor },
            CANDIDATE_BATCH_SIZE,
          );
          exhausted = candidates.length < CANDIDATE_BATCH_SIZE;
          if (!candidates.length) break;
          cursor = presentMatch(candidates[candidates.length - 1]).cursor;
          const batch = await loadPersonalMaps(tx, userId, candidates);
          for (const match of batch) {
            if (query.map) match.maps = match.maps.filter((map) => map.name === query.map);
            if (!query.map || match.maps.length) selected.push(match);
            if (selected.length > PLAYER_MATCHES_PAGE_SIZE) break;
          }
        }
        const hasMore = selected.length > PLAYER_MATCHES_PAGE_SIZE;
        const page = selected.slice(0, PLAYER_MATCHES_PAGE_SIZE);
        if (query.direction === "newer") page.reverse();
        return {
          matches: page,
          hasNewer: query.direction === "newer" ? hasMore : Boolean(query.cursor) || query.page > 1,
          hasOlder: query.direction === "older" ? hasMore : Boolean(query.cursor),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ),
  );
}
