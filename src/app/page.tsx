import { and, eq, not, count, or, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, seasonRegistrations, users } from "@/db/schema";
import { captainVotes } from "@/db/schema/votes";
import { matches } from "@/db/schema/matches";
import { normalizeRegistrationConfig } from "@/types/season";
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

export default async function HomePage() {
  const activeSeasons = await db
    .select()
    .from(seasons)
    .where(
      and(
        not(eq(seasons.status, "archived")),
        not(eq(seasons.status, "draft"))
      )
    )
    .orderBy(seasons.createdAt);

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

  // 历届已归档赛季
  const archivedSeasons = await db
    .select({ id: seasons.id, name: seasons.name, slug: seasons.slug, kind: seasons.kind, status: seasons.status })
    .from(seasons)
    .where(eq(seasons.status, "archived"))
    .orderBy(desc(seasons.createdAt))
    .limit(6);

  // 并行查询：基础统计 + 按状态的动态数据
  const [
    [featuredTeamCount],
    [featuredPlayerCount],
    registrationCounts,
    topVoteCandidates,
    liveAndUpcomingMatches,
  ] = await Promise.all([
    db.select({ value: count() }).from(teams).where(eq(teams.seasonId, featured.id)),
    db.select({ value: count() }).from(seasonRegistrations).where(
      and(eq(seasonRegistrations.seasonId, featured.id), eq(seasonRegistrations.status, "approved"))
    ),
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
    // 仅 voting 状态时查询 TOP 3 候选人
    featured.status === "voting"
      ? db
          .select({
            candidateRegistrationId: captainVotes.candidateRegistrationId,
            voteCount: count(),
          })
          .from(captainVotes)
          .where(
            inArray(
              captainVotes.candidateRegistrationId,
              db
                .select({ id: seasonRegistrations.id })
                .from(seasonRegistrations)
                .where(eq(seasonRegistrations.seasonId, featured.id))
            )
          )
          .groupBy(captainVotes.candidateRegistrationId)
          .orderBy(desc(count()))
          .limit(3)
      : Promise.resolve([] as { candidateRegistrationId: string; voteCount: number }[]),
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

  // voting 状态：查询候选人名字
  let topCandidatesWithNames: { name: string; voteCount: number }[] = [];
  if (featured.status === "voting" && topVoteCandidates.length > 0) {
    const regIds = topVoteCandidates.map((v) => v.candidateRegistrationId);
    const regRows = await db
      .select({
        id: seasonRegistrations.id,
        userId: seasonRegistrations.userId,
      })
      .from(seasonRegistrations)
      .where(inArray(seasonRegistrations.id, regIds));

    const userIds = regRows.map((r) => r.userId);
    const userRows = await db
      .select({ id: users.id, perfectName: users.perfectName, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds));

    topCandidatesWithNames = topVoteCandidates.map((v) => {
      const reg = regRows.find((r) => r.id === v.candidateRegistrationId);
      const user = reg ? userRows.find((u) => u.id === reg.userId) : undefined;
      const name = user?.displayName ?? user?.perfectName ?? "未知选手";
      return { name, voteCount: Number(v.voteCount) };
    });
  }

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
          topCandidatesWithNames={topCandidatesWithNames}
          liveAndUpcomingMatches={liveAndUpcomingMatches}
          teamCount={featuredTeamCount?.value ?? 0}
          playerCount={featuredPlayerCount?.value ?? 0}
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
