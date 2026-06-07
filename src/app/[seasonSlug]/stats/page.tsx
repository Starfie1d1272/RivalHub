import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeasonLeaderboard } from "@cs2dak/react";
import { eq } from "drizzle-orm";
import { getCurrentSeasonAnalysis } from "@/actions/dak-analysis";
import { Marker, Panel } from "@/components/rivalhub";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";

interface StatsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  return { title: season ? `${season.name} · 数据统计` : "数据统计" };
}

export default async function StatsPage({ params }: StatsPageProps) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();

  const result = await getCurrentSeasonAnalysis(season.id);
  const analysis = result.success ? result.data : null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl space-y-6">
      <Marker sub={season.name}>赛季数据分析</Marker>
      {analysis ? (
        <>
          <p className="text-xs text-[var(--color-fg-dim)]">
            DAK cohort · {analysis.cohort.matchCount} 张地图 · {analysis.cohort.players.length} 名选手
            {analysis.weightsVersion ? ` · ${analysis.weightsVersion}` : ""}
          </p>
          <SeasonLeaderboard model={analysis.leaderboard} />
        </>
      ) : (
        <Panel label="DAK Analysis">
          <p className="text-sm text-[var(--color-fg-mid)]">
            暂无赛季分析快照。请在管理后台完成全部 Demo 导入并重算赛季分析。
          </p>
        </Panel>
      )}
    </div>
  );
}
