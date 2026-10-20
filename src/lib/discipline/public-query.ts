import "server-only";

import { and, desc, eq, getTableName, lte, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, type DB } from "@/db/client";
import { disciplinaryCases, seasons } from "@/db/schema";
import { serializeSanctionPublic } from "./service";

/** A boolean projection inside the existing list query; never one request per avatar.
 * Read at request time so expiry/revocation cannot outlive a cached identity. */
export function hasActivePublicSanction(userId: AnyPgColumn) {
  // Drizzle removes column qualification in single-table SELECT projections.
  // Preserve the outer reference inside this correlated subquery explicitly.
  const subject = sql`${sql.identifier(getTableName(userId.table))}.${sql.identifier(userId.name)}`;
  return sql<boolean>`exists (
    select 1 from public.disciplinary_cases public_sanction
    inner join public.seasons public_sanction_event on public_sanction_event.id = public_sanction.season_id
    where public_sanction.subject_user_id = ${subject}
      and public_sanction_event.status <> 'draft'
      and public_sanction.status = 'active'
      and public_sanction.effective_from <= now()
      and (public_sanction.effective_until is null or public_sanction.effective_until > now())
  )`;
}

/** Only serializer-approved columns are read. Internal evidence/actors never enter the projection. */
export async function getPublicPlayerSanctions(userId: string, database: Pick<DB, "select"> = db, now = new Date()) {
  const rows = await database.select({
    id: disciplinaryCases.id,
    seasonId: disciplinaryCases.seasonId,
    subjectUserId: disciplinaryCases.subjectUserId,
    status: disciplinaryCases.status,
    effects: disciplinaryCases.effects,
    publicExplanation: disciplinaryCases.publicExplanation,
    effectiveFrom: disciplinaryCases.effectiveFrom,
    effectiveUntil: disciplinaryCases.effectiveUntil,
    createdAt: disciplinaryCases.createdAt,
    seasonName: seasons.name,
    seasonSlug: seasons.slug,
  }).from(disciplinaryCases)
    .innerJoin(seasons, eq(seasons.id, disciplinaryCases.seasonId))
    .where(and(eq(disciplinaryCases.subjectUserId, userId), ne(disciplinaryCases.status, "draft"), lte(disciplinaryCases.effectiveFrom, now), ne(seasons.status, "draft")))
    .orderBy(desc(disciplinaryCases.effectiveFrom), desc(disciplinaryCases.id));
  return rows.map((row) => ({ ...serializeSanctionPublic(row, now), seasonName: row.seasonName, seasonSlug: row.seasonSlug }))
    .filter((row) => row.status !== "draft");
}

export type PublicPlayerSanction = Awaited<ReturnType<typeof getPublicPlayerSanctions>>[number];
