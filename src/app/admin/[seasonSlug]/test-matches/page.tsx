import { Suspense } from "react";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosters, seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { loadTestMatches } from "@/lib/matches/test-matches";
import { TestMatchForm } from "@/components/matches/TestMatchForm";
import { TestMatchList } from "@/components/matches/TestMatchList";
import { PageHeader, Section } from "@/components/rivalhub";

export default function TestMatchesPage(props: { params: Promise<{ seasonSlug: string }> }) {
  return <Suspense fallback={<p role="status">正在加载测试赛…</p>}><TestMatchesContent {...props} /></Suspense>;
}

async function TestMatchesContent({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();
  if (!await resolveAdminPageAccess(() => requireSeasonAdmin(season.id))) return <AdminAccessDenied />;
  const [entries, testMatches] = await Promise.all([
    db.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries).innerJoin(eventRosters, and(eq(eventRosters.entryId, competitionEntries.id), eq(eventRosters.sourceRosterRevisionId, competitionEntries.approvedRosterRevisionId)))
      .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved"), inArray(eventRosters.status, ["confirmed", "frozen"]))).orderBy(competitionEntries.name),
    loadTestMatches({ seasonId: season.id }),
  ]);
  return <div className="space-y-8"><PageHeader title="测试赛" description="完整演练名单、BP、解说、实时转播与赛后上传。凭比赛链接即可观看，不计入正式赛程和统计。" />
    <Section><h2 className="mb-4 text-lg font-semibold">创建测试赛</h2>{entries.length >= 2 ? <TestMatchForm seasonId={season.id} entries={entries} /> : <p className="text-sm text-[var(--color-fg-mid)]">至少需要两支已批准且正式名单已确认的队伍，请先通过正式名单入口完成确认。</p>}</Section>
    <Section><h2 className="mb-4 text-lg font-semibold">测试赛记录</h2><TestMatchList matches={testMatches} admin /></Section>
  </div>;
}
