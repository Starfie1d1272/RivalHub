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

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <TeamPublicProfile team={team} />
    </PageLayout>
  );
}

function TeamProfileFallback() {
  return <div className="container mx-auto min-h-[60vh] max-w-6xl px-4 py-12" aria-busy="true" />;
}
