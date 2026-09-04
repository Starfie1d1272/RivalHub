import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { CommunityAwardsBoard } from "@/components/community-awards/CommunityAwardsBoard";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getAdminCommunityAwardBoardData } from "@/lib/community-awards/data";
import { normalizeStagePlan } from "@/types/season";

export default async function AdminCommunityAwardsPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();
  if (!season.hasCommunityAwards) notFound();
  const admin = await requireSeasonAdmin(season.id);
  const data = await getAdminCommunityAwardBoardData(db, { seasonId: season.id, stagePlan: normalizeStagePlan(season.stagePlan) });
  const groups = [
    { label: "待审核", awards: data.awards.filter((award) => award.status === "pending_review" || award.status === "rejected") },
    { label: "已公开待结奖", awards: data.awards.filter((award) => award.status === "approved") },
    { label: "已结束", awards: data.awards.filter((award) => ["awarded", "not_awarded", "cancelled", "withdrawn"].includes(award.status)) },
  ];
  return <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8"><div><h1 className="text-2xl font-bold">社区奖管理 · {season.name}</h1><p className="mt-1 text-sm text-[var(--color-fg-mid)]">审核、补充、证据、结奖与纠错均在此完成。</p></div>{groups.map((group) => <section key={group.label} className="space-y-3"><h2 className="text-lg font-semibold">{group.label}</h2><CommunityAwardsBoard seasonId={season.id} awards={group.awards} currentUserId={admin.userId} isAdmin candidates={data.candidates} matches={data.matches} allowSubmission={false} /></section>)}</div>;
}
