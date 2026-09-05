import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { PostEventManagement } from "@/components/admin/PostEventManagement";
import { SeasonPostEventOverview } from "@/components/admin/SeasonPostEventOverview";
import { Marker } from "@/components/rivalhub";
import { loadPostEventPageData } from "@/lib/admin/season-workspace/post-event";

export default async function AdminSeasonPostEventPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();

  const { data, season: postEventSeason } = await loadPostEventPageData(season);
  if (postEventSeason.competitionTemplate !== "major") {
    return <SeasonPostEventOverview data={{ season: postEventSeason, data }} />;
  }

  return <div className="space-y-5">
    <Marker sub="赛事 closure、官方结果、裁决与荣誉">赛后 · {season.name}</Marker>
    <PostEventManagement data={data} />
  </div>;
}
