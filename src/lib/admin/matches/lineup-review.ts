import "server-only";

import { and, asc, count, eq, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type TxDb } from "@/db/client";
import { competitionEntries, matches, matchRosters, type MatchRosterStatus } from "@/db/schema";
import { findAdminSeasonOverviewBySlug } from "@/lib/admin/season-context";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { officialMatchCondition } from "@/lib/matches/scope";

const PAGE_SIZE = 25;

function lineupReviewFacts(database: Pick<TxDb, "select">, seasonId: string) {
  const a = alias(matchRosters, "lineup_a");
  const b = alias(matchRosters, "lineup_b");
  return database
    .select({
      id: matches.id,
      stage: matches.stage,
      scheduledAt: matches.scheduledAt,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      statusA: sql<MatchRosterStatus | null>`${a.status}`.as("status_a"),
      statusB: sql<MatchRosterStatus | null>`${b.status}`.as("status_b"),
    })
    .from(matches)
    .leftJoin(a, and(eq(a.matchId, matches.id), eq(a.entryId, matches.entryAId)))
    .leftJoin(b, and(eq(b.matchId, matches.id), eq(b.entryId, matches.entryBId)))
    .where(
      and(
        eq(matches.seasonId, seasonId),
        officialMatchCondition(),
        eq(matches.status, "scheduled"),
        isNotNull(matches.scheduledAt),
        or(
          sql`${a.status} IS DISTINCT FROM 'confirmed'`,
          sql`${b.status} IS DISTINCT FROM 'confirmed'`,
        ),
      ),
    )
    .as("scheduled_lineup_review");
}

export async function readAdminLineupReviewSummary(
  seasonId: string,
  database: Pick<TxDb, "select"> = db,
): Promise<{ total: number; onlyMatchId: string | null }> {
  const facts = lineupReviewFacts(database, seasonId);
  const [row] = await database
    .select({ total: count(), firstId: sql<string | null>`min(${facts.id}::text)` })
    .from(facts);
  return { total: row.total, onlyMatchId: row.total === 1 ? row.firstId : null };
}

export async function loadAdminLineupReviewQueue(seasonSlug: string, requestedPage?: string) {
  const season = await findAdminSeasonOverviewBySlug(seasonSlug);
  if (!season) return null;
  await requireSeasonAdmin(season.id);

  return db.transaction(
    async (tx) => {
      const { total } = await readAdminLineupReviewSummary(season.id, tx);
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const requested = Number(requestedPage);
      const page = Math.min(
        Number.isSafeInteger(requested) && requested > 0 ? requested : 1,
        totalPages,
      );
      const facts = lineupReviewFacts(tx, season.id);
      const a = alias(competitionEntries, "lineup_team_a");
      const b = alias(competitionEntries, "lineup_team_b");
      const rows =
        total === 0
          ? []
          : await tx
              .select({
                id: facts.id,
                stage: facts.stage,
                scheduledAt: facts.scheduledAt,
                statusA: facts.statusA,
                statusB: facts.statusB,
                nameA: a.name,
                nameB: b.name,
              })
              .from(facts)
              .innerJoin(a, eq(a.id, facts.entryAId))
              .innerJoin(b, eq(b.id, facts.entryBId))
              .orderBy(asc(facts.scheduledAt), asc(facts.id))
              .limit(PAGE_SIZE)
              .offset((page - 1) * PAGE_SIZE);

      return {
        season: { name: season.name, stagePlan: season.stagePlan },
        rows,
        total,
        page,
        totalPages,
        pageSize: PAGE_SIZE,
      };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}
