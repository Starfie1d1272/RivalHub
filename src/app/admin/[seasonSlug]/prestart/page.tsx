import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import { SeasonPrestartCapabilityPanel } from "@/components/admin/SeasonPrestartCapabilityPanel";
import { loadMajorPrestartPageData } from "@/lib/admin/season-workspace/major-prestart";
import { normalizeStagePlan } from "@/types/season";

export default async function AdminSeasonPrestartPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();

  if (season.competitionTemplate === "major") {
    const data = await loadMajorPrestartPageData(season);
    return <MajorPrestartConsole seasonName={data.season.name} readiness={data.readiness} management={data.management} seedManagement={data.seedManagement} started={data.started} />;
  }

  return <SeasonPrestartCapabilityPanel
    seasonSlug={season.slug}
    seasonName={season.name}
    hasCaptainVoting={season.hasCaptainVoting}
    hasDraft={season.hasDraft}
    stagePlan={normalizeStagePlan(season.stagePlan).map((stage) => ({ key: stage.key, name: stage.name, type: stage.type }))}
  />;
}
