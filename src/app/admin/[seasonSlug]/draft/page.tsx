import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, count } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, competitionEntries } from "@/db/schema";
import { PageHeader } from "@/components/rivalhub";
import { DraftAdminPanel } from "@/components/draft/DraftAdminPanel";
import { getDraftAdminData } from "@/lib/draft/data";

interface AdminDraftPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: AdminDraftPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  return { title: `选秀管理 · ${seasonSlug}` };
}

export default async function AdminDraftPage({ params }: AdminDraftPageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const [teamCountRow] = await db
    .select({ count: count() })
    .from(competitionEntries)
    .where(eq(competitionEntries.competitionId, season.id));
  const teamCount = Number(teamCountRow?.count ?? 0);

  const data = season.hasDraft ? await getDraftAdminData(season.id) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={`选秀管理 · ${season.name}`} description="启动、暂停、恢复选秀流程。选秀开始后选手可围观实时进度。" />

      <DraftAdminPanel
        seasonId={season.id}
        seasonName={season.name}
        seasonStatus={season.status}
        teamCount={teamCount}
        data={data}
      />
    </div>
  );
}
