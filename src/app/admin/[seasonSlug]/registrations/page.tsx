import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { registrationDrafts, seasons } from "@/db/schema";
import { PageHeader } from "@/components/rivalhub";
import { RegistrationReviewList } from "@/components/admin/RegistrationReviewList";
import { DraftRegistrationTable } from "@/components/admin/DraftRegistrationTable";
import { CompetitionEntryReviewList } from "@/components/admin/CompetitionEntryReviewList";
import { TeamRegistrationProgress } from "@/components/admin/TeamRegistrationProgress";
import { isTeamRegistration } from "@/lib/utils/season";
import {
  getSoloRegistrationReview,
  getTeamRegistrationProgress,
  getTeamRegistrationReview,
  normalizeSoloRegistrationReviewQuery,
  normalizeTeamRegistrationReviewQuery,
} from "@/lib/registrations/admin-review";
import type { RegistrationReviewSearchParams } from "@/lib/registrations/admin-review-contract";
import { presentSeasonStatus } from "@/lib/seasons/presentation";

interface PageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminRegistrationsPage({ params, searchParams }: PageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const rawSearchParams: RegistrationReviewSearchParams = await searchParams ?? {};

  if (isTeamRegistration(season)) {
    const query = normalizeTeamRegistrationReviewQuery(rawSearchParams);
    const [review, progress] = await Promise.all([
      getTeamRegistrationReview(season, query),
      getTeamRegistrationProgress(season),
    ]);
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader
          title={`赛事报名审核 · ${season.name}`}
          description={`${progress.summary.total} 支队伍已开始报名 · ${review.total} 支符合当前审核筛选 · 赛季状态：${presentSeasonStatus(season.status).label}`}
        />
        <TeamRegistrationProgress progress={progress} />
        <CompetitionEntryReviewList
          seasonSlug={seasonSlug}
          entries={review.rows}
          total={review.total}
          page={review.page}
          pageSize={review.pageSize}
          totalPages={review.totalPages}
          normalizedQuery={review.normalizedQuery}
          hasAnyRecords={review.hasAnyRecords}
          startedCount={progress.summary.total}
          draftCount={progress.summary.draft}
        />
      </div>
    );
  }

  const query = normalizeSoloRegistrationReviewQuery(rawSearchParams, season.positions);
  const [review, drafts] = await Promise.all([
    getSoloRegistrationReview(season.id, season.positions, query),
    db
      .select()
      .from(registrationDrafts)
      .where(eq(registrationDrafts.seasonId, season.id))
      .orderBy(desc(registrationDrafts.updatedAt)),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={`报名审核 · ${season.name}`}
        description={`${review.total} 份报名 · ${drafts.length} 份草稿 · 赛季状态：${presentSeasonStatus(season.status).label}`}
      />
      <RegistrationReviewList
        seasonSlug={seasonSlug}
        positions={season.positions}
        registrations={review.rows}
        total={review.total}
        page={review.page}
        pageSize={review.pageSize}
        totalPages={review.totalPages}
        normalizedQuery={review.normalizedQuery}
        hasAnyRecords={review.hasAnyRecords}
      />
      <DraftRegistrationTable drafts={drafts} />
    </div>
  );
}
