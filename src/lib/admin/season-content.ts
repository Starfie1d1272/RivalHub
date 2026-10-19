import "server-only";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";

export async function loadSeasonContentContext(slug: string) {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, slug), columns: { id: true, name: true, slug: true } });
  if (!season) notFound();
  const admin = await requireSeasonAdmin(season.id);
  return { season, admin };
}
