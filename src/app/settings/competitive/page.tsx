export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitiveRankFacts, userCompetitiveRoles } from "@/db/schema";
import { CompetitiveProfileForm, type CompetitiveSeasonContext } from "@/components/settings/CompetitiveProfileForm";
import { CompetitiveRolesForm } from "@/components/settings/CompetitiveRolesForm";
import { getUserSession } from "@/lib/auth/session";
import { loadCompetitivePlatformCatalog, resolveCatalogSeasonRoles } from "@/lib/competitive/catalog";

export default async function CompetitiveProfileSettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/competitive");
  const [catalog, facts, roles] = await Promise.all([
    loadCompetitivePlatformCatalog(db),
    db.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, session.userId)),
    db.select().from(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, session.userId)),
  ]);
  const contexts: CompetitiveSeasonContext[] = catalog.map((platform) => {
    const { current, previous } = resolveCatalogSeasonRoles(platform);
    const ladder = [...platform.ranks].sort((a, b) => a.sortOrder - b.sortOrder)
      .map((rank) => ({ rankKey: rank.rankKey, label: rank.label, starMin: rank.starMin, starMax: rank.starMax }));
    return {
      platform: platform.key,
      platformDisplayName: platform.displayName,
      ratingLabel: platform.ratingLabel,
      ladder,
      seasons: [...platform.seasons]
        .sort((a, b) => b.sortOrder - a.sortOrder)
        .map((season) => ({
          seasonKey: season.seasonKey,
          label: season.label,
          isCurrent: season.id === current?.id,
          isPrevious: previous ? season.id === previous.id : false,
        })),
      facts: facts.filter((item) => item.platform === platform.key).map((item) => ({ kind: item.kind, platformSeasonKey: item.platformSeasonKey, rank: item.rank, rating: String(item.rating), stars: item.stars })),
    };
  });
  return <div className="space-y-5"><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">PARTICIPANT PROFILE</p><h1 className="mt-1 text-3xl font-semibold">竞技档案</h1></div><CompetitiveRolesForm initialRoles={roles.map((role) => role.role)} initialPrimaryRole={roles.find((role) => role.isPrimary)?.role ?? null} /><CompetitiveProfileForm contexts={contexts} /></div>;
}
