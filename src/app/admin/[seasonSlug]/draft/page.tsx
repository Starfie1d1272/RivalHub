import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, count } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams } from "@/db/schema";
import { Marker } from "@/components/rivalhub";
import { DraftAdminPanel } from "@/components/draft/DraftAdminPanel";
import { getDraftData } from "@/lib/draft/data";

export const dynamic = "force-dynamic";

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
    .from(teams)
    .where(eq(teams.seasonId, season.id));
  const teamCount = Number(teamCountRow?.count ?? 0);

  const data = season.hasDraft ? await getDraftData(season.id) : null;

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <Marker sub="启动、暂停、恢复选秀流程。选秀开始后选手可围观实时进度。">选秀管理 · {season.name}</Marker>
      </div>

      <DraftAdminPanel
        seasonId={season.id}
        seasonName={season.name}
        seasonStatus={season.status}
        teamCount={teamCount}
        data={data}
      />
    </main>
  );
}
