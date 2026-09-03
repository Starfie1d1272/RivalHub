import { Suspense } from "react";
import { connection } from "next/server";
import { and, eq, count, or, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, seasonRegistrations, users } from "@/db/schema";
import { captainVotes } from "@/db/schema/votes";
import { matches } from "@/db/schema/matches";
import { normalizeRegistrationConfig } from "@/types/season";
import { getPublicSeasonCatalog } from "@/lib/data/public-seasons";
import {
  buildHomeEyebrow,
  buildHomeNavEntries,
  selectHomeNavTiers,
} from "@/lib/home/navigation";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNavigation } from "@/components/home/HomeNavigation";
import { HomeSeasonPanel } from "@/components/home/HomeSeasonPanel";
import { SeasonCardGrid } from "@/components/home/SeasonCardGrid";
import { Panel, EmptyState } from "@/components/rivalhub";
import { getParticipantSummary } from "@/lib/participants/summary";

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  await connection();
  const allSeasons = await getPublicSeasonCatalog();
  const activeSeasons = allSeasons
    .filter((season) => season.status !== "archived")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const featured = activeSeasons[0];
  const others = activeSeasons.slice(1);

  if (!featured) {
    return (
      <div className="mx-auto px-4 lg:px-9 py-8 max-w-[1240px]">
        <Panel>
          <EmptyState
            title="暂无进行中的赛季"
            sub="请通过管理后台创建赛季。"
          />
        </Panel>
      </div>
    );
  }

  const archivedSeasons = allSeasons
    .filter((season) => season.status === "archived")
    .slice(0, 6);

  // 并行查询：基础统计 + 按状态的动态数据
  const [
    [featuredTeamCount],
    participantSummary,
    registrationCounts,
    topCandidatesWithNames,
    liveAndUpcomingMatches,
  ] = await Promise.all([
    db.select({ value: count() }).from(competitionEntries).where(eq(competitionEntries.competitionId, featured.id)),
    getParticipantSummary(featured),
    // 仅 registration 状态时查询
    featured.status === "registration"
      ? db
          .select({
            position: seasonRegistrations.primaryPosition,
            cnt: count(),
          })
          .from(seasonRegistrations)
          .where(
            and(
              eq(seasonRegistrations.seasonId, featured.id),
              or(
                eq(seasonRegistrations.status, "approved"),
                eq(seasonRegistrations.status, "pending")
              )
            )
          )
          .groupBy(seasonRegistrations.primaryPosition)
      : Promise.resolve([] as { position: string; cnt: number }[]),
    // 仅 voting 状态时查询 TOP 3 候选人及姓名，避免二次串行查询。
    featured.status === "voting"
      ? db
          .select({
            displayName: users.displayName,
            perfectName: users.perfectName,
            voteCount: count(),
          })
          .from(captainVotes)
          .innerJoin(
            seasonRegistrations,
            eq(captainVotes.candidateRegistrationId, seasonRegistrations.id),
          )
          .innerJoin(users, eq(seasonRegistrations.userId, users.id))
          .where(eq(seasonRegistrations.seasonId, featured.id))
          .groupBy(users.id, users.displayName, users.perfectName)
          .orderBy(desc(count()))
          .limit(3)
      : Promise.resolve([] as { displayName: string | null; perfectName: string | null; voteCount: number }[]),
    // 仅 playing 状态时查询 LIVE + 下一场
    featured.status === "playing"
      ? db
          .select({
            id: matches.id,
            status: matches.status,
            scheduledAt: matches.scheduledAt,
            format: matches.format,
          })
          .from(matches)
          .where(
            and(
              eq(matches.seasonId, featured.id),
              or(
                eq(matches.status, "in_progress"),
                eq(matches.status, "scheduled")
              )
            )
          )
          .orderBy(matches.scheduledAt)
          .limit(2)
      : Promise.resolve([] as { id: string; status: string; scheduledAt: Date | null; format: string }[]),
  ]);

  const namedCandidates = topCandidatesWithNames.map((candidate) => ({
    name: candidate.displayName ?? candidate.perfectName ?? "未知选手",
    voteCount: Number(candidate.voteCount),
  }));

  // registration 状态：整理位置报名数据
  const regConfig = normalizeRegistrationConfig(featured.registrationConfig);
  const maxPerPosition = regConfig.maxPerPosition;
  const positionCountMap = new Map<string, number>(
    registrationCounts.map((r) => [r.position, Number(r.cnt)])
  );

  const eyebrow = buildHomeEyebrow(featured.status, featured.slug);
  const { tier1Entry, tier2Entries, tier3Entries } = selectHomeNavTiers(
    buildHomeNavEntries(featured),
    featured.status
  );

  return (
    <div className="mx-auto px-4 lg:px-9 py-8 max-w-[1240px] grid gap-7">
      {/* Hero */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1.6fr_1fr]">
        <HomeHero season={featured} eyebrow={eyebrow} />
        <HomeSeasonPanel
          season={featured}
          maxPerPosition={maxPerPosition}
          positionCountMap={positionCountMap}
          topCandidatesWithNames={namedCandidates}
          liveAndUpcomingMatches={liveAndUpcomingMatches}
          teamCount={featuredTeamCount?.value ?? 0}
          playerCount={participantSummary.count}
        />
      </div>

      <HomeNavigation
        tier1Entry={tier1Entry}
        tier2Entries={tier2Entries}
        tier3Entries={tier3Entries}
      />
      <SeasonCardGrid markerNum={2} markerSub="MORE" title="其他赛季" seasons={others} />
      <SeasonCardGrid
        markerNum={3}
        markerSub="ARCHIVE"
        title="历届赛季"
        seasons={archivedSeasons}
      />
    </div>
  );
}

function HomeFallback() {
  return (
    <div className="mx-auto px-4 lg:px-9 py-8 max-w-[1240px]">
      <Panel>
        <EmptyState title="正在加载赛季" sub="请稍候。" />
      </Panel>
    </div>
  );
}
