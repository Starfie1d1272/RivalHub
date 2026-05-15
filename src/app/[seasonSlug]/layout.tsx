import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, seasonRegistrations } from "@/db/schema";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { SeasonNav } from "@/components/layout/season-nav";
import { hexToRgbString } from "@/lib/utils/color";
import { normalizeStagePlan } from "@/types/season";
import { showStats } from "@/lib/utils/season";

const getSeason = cache(async (slug: string) => {
  return db.query.seasons.findFirst({ where: eq(seasons.slug, slug) });
});

interface SeasonLayoutProps {
  children: React.ReactNode;
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: SeasonLayoutProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getSeason(seasonSlug);
  return {
    title: season?.name ?? seasonSlug,
  };
}

export default async function SeasonLayout({ children, params }: SeasonLayoutProps) {
  const { seasonSlug } = await params;

  const season = await getSeason(seasonSlug);

  if (!season) notFound();

  // 查询已通过审核的报名数，用于决定是否显示「选手」导航项
  const [approvedResult] = await db
    .select({ cnt: count() })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.status, "approved"),
      ),
    );
  const hasPlayers = (approvedResult?.cnt ?? 0) > 0;

  const themeColor = season.themeColor ?? "#f97316";

  return (
    <div
      data-season={seasonSlug}
      style={{
        "--color-accent": themeColor,
        "--color-accent-rgb": hexToRgbString(themeColor),
      } as React.CSSProperties}
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
        hasCaptainVoting={season.hasCaptainVoting}
        hasDraft={season.hasDraft}
        hasMatches={normalizeStagePlan(season.stagePlan).length > 0}
        hasStats={showStats(season)}
        hasPlayers={hasPlayers}
      />
      {children}
    </div>
  );
}
