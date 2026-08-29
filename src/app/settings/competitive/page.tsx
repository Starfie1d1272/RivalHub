import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitivePlatformSeasons, competitiveRankFacts } from "@/db/schema";
import { CompetitiveProfileForm, type CompetitiveSeasonContext } from "@/components/settings/CompetitiveProfileForm";
import { getUserSession } from "@/lib/auth/session";

export default async function CompetitiveProfileSettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/competitive");
  const [catalog, facts] = await Promise.all([
    db.select().from(competitivePlatformSeasons).orderBy(asc(competitivePlatformSeasons.platform), asc(competitivePlatformSeasons.sortOrder)),
    db.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, session.userId)),
  ]);
  const contexts: CompetitiveSeasonContext[] = [...new Set(catalog.map((item) => item.platform))].flatMap((platform) => {
    const entries = catalog.filter((item) => item.platform === platform && item.active);
    const current = entries.find((item) => item.isCurrent);
    if (!current) return [];
    const previous = [...entries].filter((item) => item.sortOrder < current.sortOrder).sort((a, b) => b.sortOrder - a.sortOrder)[0] ?? null;
    const seasons = [...entries]
      .sort((a, b) => b.sortOrder - a.sortOrder)
      .map((entry) => ({
        seasonKey: entry.seasonKey,
        label: entry.label,
        rankOrder: entry.rankOrder.length > 0 ? entry.rankOrder : current.rankOrder,
        isCurrent: entry.id === current.id,
        isPrevious: previous ? entry.id === previous.id : false,
      }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || Number(b.isPrevious) - Number(a.isPrevious));
    return [{ platform, seasons, facts: facts.filter((item) => item.platform === platform).map((item) => ({ kind: item.kind, platformSeasonKey: item.platformSeasonKey, rank: item.rank, rating: String(item.rating) })) }];
  });
  return <div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">PARTICIPANT PROFILE</p><h1 className="mt-1 text-3xl font-semibold">竞技档案</h1></div><CompetitiveProfileForm contexts={contexts} /></div>;
}
