import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { SeasonNav } from "@/components/layout/SeasonNav";
import { hexToRgbString } from "@/lib/utils/color";
import { normalizeStagePlan } from "@/types/season";
import { showStats } from "@/lib/utils/season";
import {
  getPublicOrAuthorizedDraftSeason,
  getPublicSeasonBySlug,
} from "@/lib/data/public-seasons";

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

  return (
    <div
      data-season={seasonSlug}
      style={season.themeColor ? {
        "--color-accent": season.themeColor,
        "--color-accent-rgb": hexToRgbString(season.themeColor),
      } as React.CSSProperties : undefined}
    >
      <div className="container mx-auto px-4 pt-6">
        <Breadcrumb
          items={[
            { label: "首页", href: "/" },
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
        hasMatches={normalizeStagePlan(season.stagePlan).length > 0}
        hasStats={showStats(season)}
      />
      {children}
    </div>
  );
}

function SeasonLayoutFallback() {
  return <div className="min-h-[50vh]" aria-busy="true" />;
}
