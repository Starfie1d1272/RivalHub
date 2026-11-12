import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, type DB } from "@/db/client";
import { matchVetoInvalidations, matches, seasons } from "@/db/schema";
import { captureException } from "@/lib/observability/server";
import { acknowledgeAfterExpiry, revalidateMatchProjectionPaths } from "./next-adapter";

/** The foreground path and scheduler use the same committed watermark and delivery plan. */
export async function deliverMatchProjectionInvalidations(
  mode: "action" | "route",
  matchIds?: readonly string[],
  database: DB = db,
) {
  if (matchIds?.length === 0) return { processed: 0 };
  const pending = database
    .select({
      matchId: matchVetoInvalidations.matchId,
      generation: matchVetoInvalidations.generation,
      affectedFacts: matchVetoInvalidations.affectedFacts,
      slug: seasons.slug,
      seasonId: seasons.id,
      matchStatus: matches.status,
    })
    .from(matchVetoInvalidations)
    .innerJoin(matches, eq(matches.id, matchVetoInvalidations.matchId))
    .innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .where(
      and(
        gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration),
        matchIds ? inArray(matchVetoInvalidations.matchId, [...matchIds]) : undefined,
      ),
    );
  const rows = await (matchIds ? pending : pending.orderBy(asc(matchVetoInvalidations.updatedAt)).limit(50));
  if (!rows.length) return { processed: 0 };

  const seenTags = new Map<string, boolean>();
  const delivered: typeof rows = [];
  const failures: typeof rows = [];
  let firstFailure: unknown;
  for (const row of rows) {
    try {
      revalidateMatchProjectionPaths(row, { changed: true, affectedFacts: row.affectedFacts }, { mode, seenTags });
      delivered.push(row);
    } catch (error) {
      failures.push(row);
      firstFailure ??= error;
    }
  }

  const captured = (batch: typeof rows) => and(
    gt(matchVetoInvalidations.generation, matchVetoInvalidations.publishedGeneration),
    sql`(${matchVetoInvalidations.matchId}, ${matchVetoInvalidations.generation}) IN (${sql.join(
      batch.map(({ matchId, generation }) => sql`(${matchId}::uuid, ${generation}::bigint)`),
      sql`, `,
    )})`,
  );
  if (delivered.length) {
    const hardTags = [...seenTags].filter(([, hard]) => hard).map(([tag]) => tag);
    await acknowledgeAfterExpiry(hardTags, async () => {
      try {
        await database.update(matchVetoInvalidations)
          .set({ publishedGeneration: sql`${matchVetoInvalidations.generation}` })
          .where(captured(delivered));
      } catch (error) {
        captureException("match.projection_invalidation.ack_failed", error, {
          scope: "match",
          operation: "projection-invalidation.acknowledge",
          retryable: true,
        });
      }
    });
  }
  if (failures.length) {
    await database.update(matchVetoInvalidations)
      .set({ updatedAt: sql`clock_timestamp()` })
      .where(captured(failures));
    throw firstFailure;
  }
  return { processed: rows.length };
}
