import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitivePlatformSeasons, competitiveRankFacts } from "@/db/schema";
import { CompetitiveProfileForm } from "@/components/settings/CompetitiveProfileForm";
import { getUserSession } from "@/lib/auth/session";

export default async function CompetitiveProfileSettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/competitive");
  const [catalog, facts] = await Promise.all([
    db.select().from(competitivePlatformSeasons).orderBy(asc(competitivePlatformSeasons.platform), asc(competitivePlatformSeasons.sortOrder)),
    db.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, session.userId)),
  ]);
  const contexts = [...new Set(catalog.map((item) => item.platform))].flatMap((platform) => {
    const entries = catalog.filter((item) => item.platform === platform && item.active);
    const current = entries.find((item) => item.isCurrent);
    const previous = current ? [...entries].filter((item) => item.sortOrder < current.sortOrder).at(-1) : null;
    return current && previous ? [{ platform, currentSeasonKey: current.seasonKey, currentLabel: current.label, previousSeasonKey: previous.seasonKey, previousLabel: previous.label, rankOrder: current.rankOrder }] : [];
  });
  return <div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">PARTICIPANT PROFILE</p><h1 className="mt-1 text-3xl font-semibold">竞技档案</h1></div><CompetitiveProfileForm contexts={contexts} facts={facts.map((item) => ({ platform: item.platform, kind: item.kind, platformSeasonKey: item.platformSeasonKey, rank: item.rank, rating: String(item.rating) }))} /></div>;
}
