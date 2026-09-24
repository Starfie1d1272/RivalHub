import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { resolvePublicTeamProfileTarget } from "@/lib/teams/public-profile";
import { getPublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";

export default function TeamProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<TeamProfileFallback />}>
      <TeamProfileContent params={params} />
    </Suspense>
  );
}

async function TeamProfileContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [target, session] = await Promise.all([
    resolvePublicTeamProfileTarget(slug),
    getUserSession(),
  ]);
  if (!target) notFound();
  if (target.slug !== slug) redirect(`/teams/${target.slug}`);

  const model = await getPublicLongTeamProfileReadModel(target.id, session?.userId, target);
  if (!model) notFound();

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <TeamPublicProfile team={model.profile} mapProfile={model.mapProfile} performance={model.performance} />
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
