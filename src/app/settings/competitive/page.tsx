import { ContentReady } from "@/components/telemetry/ContentReady";
import { Suspense } from "react";
import { RegistrationReturnLink } from "@/components/settings/RegistrationReturnLink";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { competitiveRankFacts, userCompetitiveRoles, userMapPreferences } from "@/db/schema";
import { CompetitiveProfileForm, type CompetitiveSeasonContext } from "@/components/settings/CompetitiveProfileForm";
import { CompetitiveRolesForm } from "@/components/settings/CompetitiveRolesForm";
import { MapPreferencesForm } from "@/components/settings/MapPreferencesForm";
import { getUserSession } from "@/lib/auth/session";
import { getPublicCompetitiveCatalog } from "@/lib/competitive/public-catalog";
import { resolveCatalogSeasonRoles } from "@/lib/competitive/catalog";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CompetitiveProfileSettingsPage({ searchParams }: PageProps) {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/competitive");
  const rawSearchParams = await searchParams;
  const requestedPlatform = typeof rawSearchParams.platform === "string" ? rawSearchParams.platform : null;
  const requestedSeason = typeof rawSearchParams.season === "string" ? rawSearchParams.season : null;
  const [catalog, facts] = await Promise.all([
    getPublicCompetitiveCatalog(),
    db.select({ platform: competitiveRankFacts.platform, kind: competitiveRankFacts.kind, platformSeasonKey: competitiveRankFacts.platformSeasonKey, status: competitiveRankFacts.status, rank: competitiveRankFacts.rank, rating: competitiveRankFacts.rating, stars: competitiveRankFacts.stars, achievedSeasonKey: competitiveRankFacts.achievedSeasonKey }).from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, session.userId)),
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
      facts: facts.filter((item) => item.platform === platform.key).map((item) => ({ kind: item.kind, platformSeasonKey: item.platformSeasonKey, status: item.status, rank: item.rank, rating: item.rating === null ? null : String(item.rating), stars: item.stars, achievedSeasonKey: item.achievedSeasonKey })),
    };
  });
  return <div className="space-y-5"><RegistrationReturnLink href={rawSearchParams.returnTo} /><div><p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">PARTICIPANT PROFILE</p><h1 className="mt-1 text-3xl font-semibold">竞技档案</h1></div><ContentReady module="account" phase="form" /><CompetitiveProfileForm contexts={contexts} initialTarget={{ platform: requestedPlatform, season: requestedSeason }} /><Suspense fallback={<div className="min-h-28" role="status">正在读取常用位置…</div>}><RolesSettings userId={session.userId} /></Suspense><Suspense fallback={<div className="min-h-28" role="status">正在读取地图熟练度…</div>}><MapSettings userId={session.userId} /></Suspense></div>;
}

async function RolesSettings({ userId }: { userId: string }) {
  const roles = await db.select({ role: userCompetitiveRoles.role, isPrimary: userCompetitiveRoles.isPrimary }).from(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, userId));
  return <CompetitiveRolesForm initialRoles={roles.map(role => role.role)} initialPrimaryRole={roles.find(role => role.isPrimary)?.role ?? null} />;
}
async function MapSettings({ userId }: { userId: string }) {
  const rows = await db.select({ mapPreferences: userMapPreferences.mapPreferences }).from(userMapPreferences).where(eq(userMapPreferences.userId, userId));
  return <MapPreferencesForm initialPreferences={rows[0]?.mapPreferences ?? []} />;
}
