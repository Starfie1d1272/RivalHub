import { findAdminSeasonBySlug } from "@/lib/admin/season-context";
import { notFound } from "next/navigation";
import Link from "next/link";

import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import { SeasonPrestartCapabilityPanel } from "@/components/admin/SeasonPrestartCapabilityPanel";
import { loadMajorPrestartPageData } from "@/lib/admin/season-workspace/major-prestart";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";

export default async function AdminSeasonPrestartPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await findAdminSeasonBySlug(seasonSlug);
  if (!season) notFound();

  if (season.competitionTemplate === "major") {
    const data = await loadMajorPrestartPageData(season);
    return <>{season.registrationMode === "solo" && <Link className="inline-block underline" href={`/admin/${season.slug}/draft`}>管理编队与名单审核</Link>}<MajorPrestartConsole seasonName={data.season.name} readiness={data.readiness} management={data.management} seedManagement={data.seedManagement} started={data.started} /></>;
  }

  return <SeasonPrestartCapabilityPanel
    seasonSlug={season.slug}
    seasonName={season.name}
    hasCaptainVoting={season.hasCaptainVoting}
    hasDraft={season.hasDraft}
    registrationMode={season.registrationMode}
    stagePlan={normalizeStagePlan(season.stagePlan).map((stage) => ({ key: stage.key, name: stage.name, type: stage.type }))}
  />;
}
