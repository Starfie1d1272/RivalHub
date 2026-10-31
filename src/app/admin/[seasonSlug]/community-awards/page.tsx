import { findAdminSeasonOverviewBySlug } from "@/lib/admin/season-context";
import { Suspense } from "react";

import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { AdminCommunityAwardsWorkspace } from "@/components/admin/AdminCommunityAwardsWorkspace";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getAdminCommunityAwardBoardSummaries } from "@/lib/community-awards/data";

export default function AdminCommunityAwardsPage(props: { params: Promise<{ seasonSlug: string }> }) {
  return <Suspense fallback={<div role="status" className="p-4 text-sm">正在加载社区奖…</div>}><AdminCommunityAwardsContent {...props} /></Suspense>;
}

async function AdminCommunityAwardsContent({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await findAdminSeasonOverviewBySlug(seasonSlug);
  if (!season) notFound();
  if (!season.hasCommunityAwards) notFound();
  const admin = await requireSeasonAdmin(season.id);
  const data = await getAdminCommunityAwardBoardSummaries(db, { seasonId: season.id });
  return <div className="min-w-0 space-y-6"><div><h1 className="text-2xl font-bold">社区奖管理 · {season.name}</h1><p className="mt-1 text-sm text-[var(--color-fg-mid)]">审核、补充、证据、结奖与纠错均在此完成。</p></div><AdminCommunityAwardsWorkspace seasonId={season.id} summaries={data.awards} currentUserId={admin.userId} stages={data.stages} /><ContentReady module="admin" phase="primary" /></div>;
}
