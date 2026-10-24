import "server-only";

import { cache } from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";

/** RSC-request reuse only. Every consumer retains its own authorization boundary. */
export const findAdminSeasonBySlug = cache((slug: string) =>
  db.query.seasons.findFirst({ where: eq(seasons.slug, slug) }));

/** Sidebar and directory share the same authorized, narrow catalog in one request. */
export const listAdminSeasonDirectory = cache(async () => {
  const actor = await requireAdmin();
  if (actor.role !== "super_admin" && actor.seasonIds.length === 0) return [];
  return db.select({
    id: seasons.id, slug: seasons.slug, name: seasons.name, status: seasons.status,
    competitionTemplate: seasons.competitionTemplate, registrationOpenedAt: seasons.registrationOpenedAt,
    hasCaptainVoting: seasons.hasCaptainVoting, hasDraft: seasons.hasDraft, hasCommunityAwards: seasons.hasCommunityAwards,
  }).from(seasons).where(actor.role === "super_admin" ? undefined : inArray(seasons.id, actor.seasonIds))
    .orderBy(desc(seasons.createdAt));
});
