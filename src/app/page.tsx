import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import Link from "next/link";
import { SeasonResults } from "@/components/season/SeasonResults";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";
import { SeasonNextStep } from "@/components/season/SeasonNextStep";
import { Suspense } from "react";
import { io } from "next/cache";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import {
  buildHomeEyebrow,
  buildHomeNavEntries,
  selectHomeNavTiers,
} from "@/lib/home/navigation";
import { getPublicHomeProjection } from "@/lib/home/read-model";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNavigation } from "@/components/home/HomeNavigation";
import { HomeSeasonPanel } from "@/components/home/HomeSeasonPanel";
import { SeasonCardGrid } from "@/components/home/SeasonCardGrid";
import { EmptyState, PageLayout, Panel } from "@/components/rivalhub";
import type { PublicSeason } from "@/lib/data/public-seasons";

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  await io();
  const allSeasons = await getPublicSeasonCatalog();
  const projection = await getPublicHomeProjection(allSeasons);
  const featured = projection.featured;

  if (!featured) {
    return (
      <PageLayout variant="wide">
        <Panel>
          <EmptyState
            title="赛事即将到来"
            sub="新赛事公布后会在这里展示。"
          />
        </Panel>
      </PageLayout>
    );
  }

  const eyebrow = buildHomeEyebrow(featured);
  const stage = await getPublicSeasonStagePresentation(featured);
  const { tier1Entry, tier2Entries, tier3Entries } = selectHomeNavTiers(
    buildHomeNavEntries(featured),
    featured.status
  );

  return (
    <PageLayout variant="wide" className="grid gap-7">
      {/* Hero */}
      <HomeHero season={featured} eyebrow={eyebrow} primary={tier1Entry} stageLabel={stage.currentStageLabel} teamCount={projection.teamCount} playerCount={projection.playerCount} />
      <Suspense fallback={null}><HomePersonalNextStep season={featured} /></Suspense>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
        {projection.results ? <SeasonResults results={projection.results} slug={featured.slug} compact /> : <HomeSeasonPanel
          season={featured}
          maxPerPosition={projection.maxPerPosition}
          positionCountMap={new Map(Object.entries(projection.positionCounts))}
          topCandidatesWithNames={projection.topCandidatesWithNames}
          liveAndUpcomingMatches={projection.liveAndUpcomingMatches}
          teamCount={projection.teamCount}
          playerCount={projection.playerCount}
        />}
        </div>
        <section className="flex flex-col justify-between gap-5 border-y border-[var(--color-border)] py-5"><div><p className="font-mono text-xs tracking-widest text-[var(--color-accent)]">FIND YOUR TEAM</p><h2 className="mt-3 text-2xl font-semibold">一起上场</h2><p className="mt-2 text-sm text-[var(--color-fg-mid)]">寻找队伍与队友，开启下一段赛事旅程。</p></div><Link href="/teams/recruitment" className="text-sm hover:text-[var(--color-accent)]">组队与招募 →</Link></section>
      </div>

      <HomeNavigation
        tier1Entry={tier1Entry}
        tier2Entries={tier2Entries}
        tier3Entries={tier3Entries}
      />
      <SeasonCardGrid markerNum={2} markerSub="MORE" title="其他赛事" seasons={projection.otherSeasons} />
      <SeasonCardGrid
        markerNum={3}
        markerSub="ARCHIVE"
        title="历届赛事"
        seasons={projection.archivedSeasons}
      />
    </PageLayout>
  );
}

async function HomePersonalNextStep({ season }: { season: PublicSeason }) {
  const task = await getSeasonPersonalNextStep(season);
  return <SeasonNextStep task={task} />;
}

function HomeFallback() {
  return (
    <PageLayout variant="wide">
      <Panel>
        <EmptyState title="正在加载赛事" sub="请稍候。" />
      </Panel>
    </PageLayout>
  );
}
