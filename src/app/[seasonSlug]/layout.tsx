import Link from "next/link";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { Button } from "@/components/ui/button";
import { PageLayout, Spinner } from "@/components/rivalhub";
import type { PublicSeason } from "@/lib/data/public-seasons";
import { io } from "next/cache";
import { TelemetryScene } from "@/components/telemetry/ProductTelemetry";
import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SeasonNav } from "@/components/layout/SeasonNav";
import { PortalThemeProvider } from "@/components/ui/portal-theme";
import { seasonAccentStyle } from "@/lib/utils/color";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { showStats } from "@/lib/utils/season";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { SeasonInformationFeedbackLauncher } from "@/components/operations/GlobalInformationFeedbackLauncher";

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

const getSeasonForRequest = cache(getPublicOrAuthorizedDraftSeason);

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getSeasonForRequest(seasonSlug);
  if (!season) notFound();
  return {
    title: season.name,
    robots: season.status === "draft" ? { index: false, follow: false } : undefined,
  };
}

export default function SeasonLayout({ children, params }: SeasonLayoutProps) {
  return (
    <div className="min-h-svh">
      <Suspense fallback={<SeasonLayoutFallback />}>
        <SeasonLayoutContent params={params}>{children}</SeasonLayoutContent>
      </Suspense>
    </div>
  );
}

async function SeasonLayoutContent({ children, params }: SeasonLayoutProps) {
  await io();
  const { seasonSlug } = await params;
  const season = await getSeasonForRequest(seasonSlug);

  if (!season) notFound();
  const stagePresentation = await getPublicSeasonStagePresentation(season);

  const theme = season.themeColor
    ? (seasonAccentStyle(season.themeColor) as React.CSSProperties)
    : undefined;

  return (
    <div data-season={seasonSlug} style={theme}>
      <PortalThemeProvider value={theme}>
        <SeasonNav
          slug={season.slug}
          seasonName={season.name}
          status={season.status}
          hasCaptainVoting={season.hasCaptainVoting}
          hasDraft={season.hasDraft}
          hasCommunityAwards={season.hasCommunityAwards}
          hasMatches={stagePresentation.officialStages.length > 0}
          hasStats={showStats(season)}
          hasPredictions={season.competitionTemplate === "major"}
          participationAction={
            <Suspense fallback={null}>
              <SeasonParticipationEntry season={season} />
            </Suspense>
          }
        />
        <TelemetryScene
          prefix={`/${seasonSlug}`}
          scene={season.competitionTemplate}
          eventId={season.id}
        />
        {children}
        <Suspense fallback={null}>
          <SeasonInformationFeedbackLauncher season={{ id: season.id, slug: season.slug }} />
        </Suspense>
      </PortalThemeProvider>
    </div>
  );
}

function SeasonLayoutFallback() {
  return (
    <PageLayout variant="wide" role="status">
      <Spinner label="正在读取赛事…" />
    </PageLayout>
  );
}

export async function SeasonParticipationEntry({ season }: { season: PublicSeason }) {
  await io();
  const task = await getSeasonPersonalNextStep(season);
  const isHistorical = season.status === "finished" || season.status === "archived";
  const registrationOpen = getRegistrationWindowState(season).canSubmit;
  const href =
    task?.href ??
    (registrationOpen || (season.registrationMode === "team" && !isHistorical)
      ? `/${season.slug}/register`
      : null);
  if (!href) return null;
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={href as import("next").Route}>
        {task?.title ?? (registrationOpen ? "报名" : "参赛事务")}
      </Link>
    </Button>
  );
}
