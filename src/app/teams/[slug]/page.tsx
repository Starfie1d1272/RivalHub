import { parseTeamProfileSection, teamProfileSectionHref } from "@/lib/teams/profile-view-state";
import { safeStatsReturn } from "@/lib/stats/return-context";
import type { StatsSearch } from "@/lib/stats/view-state";
import { StatsReturnLink } from "@/components/stats/StatsNavigationContext";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { TeamPublicProfile } from "@/components/teams/TeamPublicProfile";
import { PageLayout } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { resolvePublicTeamProfileTarget } from "@/lib/teams/public-profile";
import { getPublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<StatsSearch> };

export default function TeamProfilePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TeamProfileFallback />}>
      <TeamProfileContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TeamProfileContent({ params, searchParams }: Props) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const section = parseTeamProfileSection(search.section);
  const fromStats = safeStatsReturn(typeof search.fromStats === "string" ? search.fromStats : null);
  const [target, session] = await Promise.all([
    resolvePublicTeamProfileTarget(slug),
    getUserSession(),
  ]);
  if (!target) notFound();
  if (target.slug !== slug)
    redirect(
      `/teams/${target.slug}${teamProfileSectionHref(section, fromStats)}` as import("next").Route,
    );

  const model = await getPublicLongTeamProfileReadModel(target.id, session?.userId, target);
  if (!model) notFound();

  return (
    <PageLayout as="div" variant="standard" className="space-y-8">
      <StatsReturnLink href={fromStats} />
      <TeamPublicProfile
        section={section}
        fromStats={fromStats}
        lineupStyle={model.lineupStyle}
        team={model.profile}
        mapProfile={model.mapProfile}
        performance={model.performance}
        career={model.career}
        matches={model.matches}
        statsUnavailable={model.statsUnavailable}
      />
      <ContentReady module="team" phase="primary" />
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
