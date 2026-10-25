import { preservePublicStatsDependencyFailure } from "@/lib/stats/availability";
import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { getPlayerCareerPerformances } from "@/lib/stats/tournament-query";
import { getPlayerAttributeBenchmark } from "@/lib/stats/player-attribute-benchmark";
import { projectPlayerAttributeProfile } from "@/lib/stats/player-attributes";
import type { PublicPlayerIdentity } from "@/lib/identity/public-player";
import type { LineupStyleMember } from "./lineup-style";

async function getCareerAttributes(playerIds: string[]) {
  "use cache: remote";
  cacheTag(PUBLIC_STATS_TAG);
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
  return preservePublicStatsDependencyFailure(async () => {
  const careers = await getPlayerCareerPerformances(playerIds);
  const benchmark = careers.some(career => career.performance) ? await getPlayerAttributeBenchmark() : null;
  return careers.map(({ playerId, maps, rounds, performance }) => ({
    userId: playerId, maps, rounds,
    attributes: performance && benchmark ? projectPlayerAttributeProfile(performance, benchmark).attributes.map(({ key, score, status }) => ({ key, score, status })) : [],
  }));
  });
}

export async function getPublicLineupStyle(members: readonly PublicPlayerIdentity[]): Promise<LineupStyleMember[]> {
  if (!members.length) return [];
  const careers = new Map((await getCareerAttributes([...new Set(members.map((member) => member.userId))].sort())).map((career) => [career.userId, career]));
  return members.map((member) => ({ ...careers.get(member.userId)!, userId: member.userId, name: member.name, avatarUrl: member.avatarUrl, hasActivePublicSanction: member.hasActivePublicSanction }));
}
