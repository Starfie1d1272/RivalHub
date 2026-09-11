import { getMajorPublicParticipantOverview } from "@/lib/major/public-participants";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { SeasonResults } from "@/components/season/SeasonResults";
import { getParticipantSummary } from "@/lib/participants/summary";
import { formatCSTShortDate } from "@/lib/utils/date";
import { groupSeasonsByLifecycle, SEASON_LIFECYCLE_GROUPS } from "@/lib/seasons/presentation";
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import { presentRegistrationSchedule, presentSeasonParticipationState } from "@/lib/seasons/presentation";
import { PageHeader, PageLayout, Panel, StatusPill } from "@/components/rivalhub";

export const metadata: Metadata = { title: "赛事中心" };

export default function SeasonsPage() {
  return (
    <Suspense fallback={<SeasonsFallback />}>
      <SeasonsContent />
    </Suspense>
  );
}

async function SeasonsContent() {
  await connection();
  const allSeasons = await getPublicSeasonCatalog();

  const grouped = groupSeasonsByLifecycle(allSeasons);
  const summaries = new Map(await Promise.all(allSeasons.map(async (season) => [season.id, { participants: season.competitionTemplate === "major" ? { count: (await getMajorPublicParticipantOverview(season)).playerCount } : await getParticipantSummary(season), results: ["finished", "archived"].includes(season.status) ? await getPublicSeasonResults(season) : null }] as const)));

  return (
    <PageLayout as="div" variant="wide">
      <PageHeader title="赛事中心" description={`共 ${allSeasons.length} 个赛事`} className="mb-10" />

      {allSeasons.length === 0 ? (
        <p className="text-[var(--color-fg-dim)] text-center py-16">暂无赛事记录</p>
      ) : (
        <div className="space-y-10">
          {SEASON_LIFECYCLE_GROUPS.filter((group) => grouped[group.key].length > 0).map((group) => <section key={group.key} className="space-y-4">
            <h2 className="text-xl font-semibold">{group.label}</h2>
            <div className={group.key === "active" ? "grid gap-5 lg:grid-cols-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
              {grouped[group.key].map((season) => {
                const summary = summaries.get(season.id)!;
                const schedule = presentRegistrationSchedule(season);
                return <div key={season.id} className="space-y-3">
                  <Link href={`/${season.slug}`} className="block"><Panel hoverable>
                    <StatusPill {...presentSeasonParticipationState(season)} />
                    <h3 className="my-3 text-xl font-semibold">{season.name}</h3>
                    {schedule && <p className="text-sm">{schedule.primary}</p>}
                    <p className="text-sm text-[var(--color-fg-mid)]">{summary.participants.count} 位选手{summary.results ? ` · ${summary.results.finishedMatches} 场比赛` : ""}</p>
                    {summary.results?.completedAt && <p className="mt-2 text-xs text-[var(--color-fg-dim)]">最后赛果 · {formatCSTShortDate(summary.results.completedAt)}</p>}
                  </Panel></Link>
                  {summary.results && <SeasonResults results={summary.results} slug={season.slug} compact />}
                </div>;
              })}
            </div>
          </section>)}
        </div>
      )}
    </PageLayout>
  );
}

function SeasonsFallback() {
  return (
    <PageLayout as="div" variant="wide">
      <PageHeader title="赛事中心" description="正在读取公开赛事" />
    </PageLayout>
  );
}
