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

  const eyebrow = buildHomeEyebrow(featured.status, featured.slug, featured.registrationOpenedAt);
  const { tier1Entry, tier2Entries, tier3Entries } = selectHomeNavTiers(
    buildHomeNavEntries(featured),
    featured.status
  );

  return (
    <PageLayout variant="wide" className="grid gap-7">
      <Suspense fallback={null}>
        <HomePersonalNextStep season={featured} />
      </Suspense>
      {/* Hero */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1.6fr_1fr]">
        <HomeHero season={featured} eyebrow={eyebrow} />
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
