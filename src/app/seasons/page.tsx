import { officialMatchCondition } from "@/lib/matches/scope";
import { requireCompetitionFields } from "@/lib/matches/competition-context";
import { EventLogo } from "@/components/season/EventLogo";
import { getMajorPublicParticipantOverview } from "@/lib/major/public-participants";
import { getPublicSeasonResultSummaries } from "@/lib/seasons/public-results";
import { SeasonResults } from "@/components/season/SeasonResults";
import { getParticipantSummaries } from "@/lib/participants/summary";
import { formatCSTShortDate } from "@/lib/utils/date";
import { groupSeasonsByLifecycle, SEASON_LIFECYCLE_GROUPS } from "@/lib/seasons/presentation";
import { Suspense } from "react";
import { io } from "next/cache";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublicSeasonCatalog, type PublicSeasonWithCompletion } from "@/lib/data/public-seasons";
import { presentRegistrationSchedule, presentSeasonDirectoryActivity, presentSeasonParticipationState } from "@/lib/seasons/presentation";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { PageHeader, PageLayout, Panel, StatusPill } from "@/components/rivalhub";
import { and, asc, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";

export const metadata: Metadata = { title: "赛事中心" };

export default function SeasonsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return (
    <Suspense fallback={<SeasonsFallback />}>
      <SeasonsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SeasonsContent({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await io();
  const [allSeasons, query] = await Promise.all([getPublicSeasonCatalog(), searchParams]);
  const grouped = groupSeasonsByLifecycle(allSeasons);
  const history = [...grouped.recent, ...grouped.archived];
  const pages = Math.max(1, Math.ceil(history.length / 12));
  const requested = Number(query.page);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1;
  const visibleHistory = new Set(history.slice((page - 1) * 12, page * 12).map(season => season.id));
  return <PageLayout as="div" variant="wide">
    <PageHeader title="赛事中心" description={`共 ${allSeasons.length} 个赛事`} className="mb-10" />
    {allSeasons.length === 0 ? <p className="py-16 text-center text-[var(--color-fg-dim)]">暂无赛事记录</p> : <div className="space-y-10">
      {SEASON_LIFECYCLE_GROUPS.map(group => {
        const seasons = grouped[group.key].filter(season => group.key === "active" || visibleHistory.has(season.id));
        return seasons.length > 0 ? <section key={group.key} className="space-y-4">
          <h2 className="text-xl font-semibold">{group.label}</h2>
          <Suspense fallback={<div role="status" className="min-h-64">正在加载赛事…</div>}>
            <SeasonDirectoryCards allSeasons={seasons} active={group.key === "active"} />
          </Suspense>
        </section> : null;
      })}
      {pages > 1 && <nav aria-label="历届赛事分页" className="flex items-center gap-4">
        {page > 1 && <Link href={page === 2 ? "/seasons" : `/seasons?page=${page - 1}`}>上一页</Link>}
        <span>历届赛事 · 第 {page} / {pages} 页</span>
        {page < pages && <Link href={`/seasons?page=${page + 1}`}>下一页</Link>}
      </nav>}
    </div>}
  </PageLayout>;
}

async function SeasonDirectoryCards({ allSeasons, active }: { allSeasons: PublicSeasonWithCompletion[]; active: boolean }) {
  const participantRead = getParticipantSummaries(allSeasons.filter(season => season.competitionTemplate !== "major"));
  const resultsRead = getPublicSeasonResultSummaries(allSeasons.filter(season => ["finished", "archived"].includes(season.status)));
  const majorRead = Promise.all(allSeasons.filter(season => season.competitionTemplate === "major").map(async season => [season.id, await getMajorPublicParticipantOverview(season)] as const));
  const activeSeasonIds = allSeasons.filter((season) => season.hasOfficialMatches && !["finished", "archived"].includes(season.status)).map((season) => season.id);
  const rawActiveMatchRows = activeSeasonIds.length
    ? await db
      .selectDistinctOn([matches.seasonId], { seasonId: matches.seasonId, stage: matches.stage, status: matches.status, scheduledAt: matches.scheduledAt })
      .from(matches)
      .where(and(officialMatchCondition(), and(inArray(matches.seasonId, activeSeasonIds), inArray(matches.status, ["scheduled", "in_progress"]))))
      .orderBy(asc(matches.seasonId), desc(sql`${matches.status} = 'in_progress'`), asc(matches.scheduledAt), asc(matches.id))
    : [];
  const activeMatchRows = rawActiveMatchRows.map(requireCompetitionFields);
  const nextMatchBySeason = new Map(activeMatchRows.map((row) => [row.seasonId, row]));
  const stagePresentations = new Map(await Promise.all(
    allSeasons
      .filter((season) => nextMatchBySeason.has(season.id))
      .map(async (season) => [season.id, await getPublicSeasonStagePresentation(season)] as const),
  ));
  const [participantSummaries, results, majorOverviews] = await Promise.all([participantRead, resultsRead, majorRead]);
  const majorById = new Map(majorOverviews);
  const summaries = new Map(allSeasons.map(season => [season.id, {
    participants: season.competitionTemplate === "major" ? { count: majorById.get(season.id)!.playerCount } : participantSummaries.get(season.id)!,
    results: results.get(season.id) ?? null,
  }]));
  return <div className={active ? "grid gap-5 lg:grid-cols-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
              {allSeasons.map((season) => {
                const summary = summaries.get(season.id)!;
                const schedule = presentRegistrationSchedule(season);
                const nextMatch = nextMatchBySeason.get(season.id);
                const nextStageName = nextMatch ? stagePresentations.get(season.id)?.labels[nextMatch.stage] ?? null : null;
                const activity = presentSeasonDirectoryActivity(season, nextStageName);
                return <Panel key={season.id} hoverable contentClassName="space-y-4 p-5">
                  <Link href={`/${season.slug}`} className="block">
                    <StatusPill {...presentSeasonParticipationState(season)} />
                    <div className="my-3 flex items-center gap-3"><EventLogo logoUrl={season.logoUrl} className="h-10 w-10 shrink-0 object-contain" /><h3 className="min-w-0 text-xl font-semibold">{season.name}</h3></div>
                    {schedule && <p className="text-sm">{schedule.primary}</p>}
                    {activity && <p className="text-sm text-[var(--color-fg-mid)]">{activity}</p>}
                    <p className="text-sm text-[var(--color-fg-mid)]">{summary.participants.count} 位选手{summary.results ? ` · ${summary.results.finishedMatches} 场比赛` : ""}</p>
                    {summary.results?.completedAt && <p className="mt-2 text-xs text-[var(--color-fg-dim)]">最后赛果 · {formatCSTShortDate(summary.results.completedAt)}</p>}
                  </Link>
                  {summary.results && <SeasonResults results={summary.results} slug={season.slug} compact embedded />}
                </Panel>;
              })}
    </div>;
}

function SeasonsFallback() {
  return (
    <PageLayout as="div" variant="wide">
      <PageHeader title="赛事中心" description="正在读取公开赛事" />
    </PageLayout>
  );
}
