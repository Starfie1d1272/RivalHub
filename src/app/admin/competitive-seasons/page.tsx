import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { db } from "@/db/client";
import { competitivePlatformSeasons } from "@/db/schema";
import { CompetitiveSeasonCatalog } from "@/components/admin/CompetitiveSeasonCatalog";

export default async function CompetitiveSeasonsAdminPage() {
  try { await requireSuperAdmin(); } catch { redirect("/admin/login"); }
  const rows = await db.select().from(competitivePlatformSeasons).orderBy(asc(competitivePlatformSeasons.platform), asc(competitivePlatformSeasons.sortOrder));
  return <main className="container mx-auto max-w-4xl space-y-5 px-4 py-8"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">ADMINISTRATION</p><h1 className="mt-1 text-3xl font-semibold">竞技平台赛季</h1></div><CompetitiveSeasonCatalog rows={rows} /></main>;
}
