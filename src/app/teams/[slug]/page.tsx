import { getPublicTeamMapProfile } from "@/lib/teams/map-profile";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { getPublicTeamProfile, resolvePublicTeamProfileTarget } from "@/lib/teams/public-profile";

export default function TeamProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<TeamProfileFallback />}>
      <TeamProfileContent params={params} />
    </Suspense>
  );
}

async function TeamProfileContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const [target, session] = await Promise.all([
    resolvePublicTeamProfileTarget(slug),
    getUserSession(),
  ]);
  if (!target) notFound();
  if (target.slug !== slug) redirect(`/teams/${target.slug}`);

  const team = await getPublicTeamProfile(target.id, session?.userId, target);
  if (!team) notFound();
  const mapProfile = await getPublicTeamMapProfile(team.entries.map((entry) => entry.id), team.currentMembers.map((member) => member.userId));

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <TeamPublicProfile team={team} mapProfile={mapProfile} />
    </PageLayout>
  );
}

function TeamProfileFallback() {
  return (
    <PageLayout variant="standard" className="min-h-[60vh]" aria-busy="true">
      <span className="sr-only">正在加载队伍页面…</span>
    </PageLayout>
  );
}
