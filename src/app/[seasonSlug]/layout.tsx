import Link from "next/link";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { Button } from "@/components/ui/button";
import type { PublicSeason } from "@/lib/data/public-seasons";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { SeasonNav } from "@/components/layout/SeasonNav";
import { pageAlignmentFrame } from "@/components/rivalhub/Layout";
import { seasonAccentStyle } from "@/lib/utils/color";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { showStats } from "@/lib/utils/season";
import {
  getPublicOrAuthorizedDraftSeason,
  getPublicSeasonBySlug,
} from "@/lib/data/public-seasons";
import { SeasonInformationFeedbackLauncher } from "@/components/operations/GlobalInformationFeedbackLauncher";

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getPublicSeasonBySlug(seasonSlug);
  return {
    title: season?.name ?? seasonSlug,
  };
}

export default function SeasonLayout({ children, params }: SeasonLayoutProps) {
  return (
    <Suspense fallback={<SeasonLayoutFallback />}>
      <SeasonLayoutContent params={params}>{children}</SeasonLayoutContent>
    </Suspense>
  );
}

async function SeasonLayoutContent({ children, params }: SeasonLayoutProps) {
  await connection();
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);

  if (!season) notFound();
  const stagePresentation = await getPublicSeasonStagePresentation(season);

  return (
    <div
      data-season={seasonSlug}
      style={season.themeColor ? {
        ...seasonAccentStyle(season.themeColor),
      } as React.CSSProperties : undefined}
    >
      <div className={`${pageAlignmentFrame()} pt-5`}>
        <Breadcrumb
          items={[
            { label: "首页", href: "/" },
            { label: "赛事", href: "/seasons" },
            { label: season.name },
          ]}
        />
      </div>
      <SeasonNav
        slug={season.slug}
        status={season.status}
        hasCaptainVoting={season.hasCaptainVoting}
        hasDraft={season.hasDraft}
        hasCommunityAwards={season.hasCommunityAwards}
        hasMatches={stagePresentation.officialStages.length > 0}
        hasStats={showStats(season)}
        hasPredictions={season.competitionTemplate === "major"}
        participationAction={<Suspense fallback={null}><SeasonParticipationEntry season={season} /></Suspense>}
      />
      {children}
      <Suspense fallback={null}>
        <SeasonInformationFeedbackLauncher season={{ id: season.id, slug: season.slug }} />
      </Suspense>
    </div>
  );
}

function SeasonLayoutFallback() {
  return <div className="min-h-[50vh]" aria-busy="true" />;
}

async function SeasonParticipationEntry({ season }: { season: PublicSeason }) {
  await connection();
  const task = await getSeasonPersonalNextStep(season);
  const isHistorical = season.status === "finished" || season.status === "archived";
  const registrationOpen = getRegistrationWindowState(season).canSubmit;
  const href = task?.href ?? (registrationOpen || season.registrationMode === "team" && !isHistorical ? `/${season.slug}/register` : null);
  if (!href) return null;
  return <Button size="sm" variant="outline" asChild><Link href={href as import("next").Route}>{task?.title ?? (registrationOpen ? "报名" : "参赛事务")}</Link></Button>;
}
