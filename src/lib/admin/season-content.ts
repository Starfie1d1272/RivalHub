import "server-only";
import { notFound } from "next/navigation";
import { findAdminSeasonOverviewBySlug } from "./season-context";
import { requireSeasonAdmin } from "@/lib/auth/session";

export async function loadSeasonContentContext(slug: string) {
  const season = await findAdminSeasonOverviewBySlug(slug);
  if (!season) notFound();
  const admin = await requireSeasonAdmin(season.id);
  return { season: { id: season.id, name: season.name, slug: season.slug }, admin };
}
