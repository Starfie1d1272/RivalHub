import "server-only";

import { cache } from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";

/** RSC-request reuse only. Every consumer retains its own authorization boundary. */
export const findAdminSeasonOverviewBySlug = cache((slug: string) =>
  db.query.seasons.findFirst({ where: eq(seasons.slug, slug), columns: {
    id: true, slug: true, name: true, status: true, competitionTemplate: true, stagePlan: true,
    hasCaptainVoting: true, hasDraft: true, hasCommunityAwards: true,
  } }));

const findAdminSeasonById = cache((id: string) =>
  db.query.seasons.findFirst({ where: eq(seasons.id, id) }));

export const findAdminSeasonBySlug = cache(async (slug: string) => {
  const overview = await findAdminSeasonOverviewBySlug(slug);
  return overview ? findAdminSeasonById(overview.id) : undefined;
});

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
