import { ProfileSectionNav } from "@/components/rivalhub/ProfileSectionNav";
import { playerMatchesHref } from "@/lib/players/matches-view-state";
import {
  playerProfileHref,
  type PlayerPerformanceQuery,
  type PlayerProfileSection,
} from "@/lib/players/performance-view-state";

export function PlayerProfileNav({
  userId,
  query,
  section,
  fromStats,
}: {
  userId: string;
  query: PlayerPerformanceQuery;
  section: PlayerProfileSection | "matches";
  fromStats?: string | null;
}) {
  return (
    <ProfileSectionNav
      label="选手档案导航"
      items={[
        {
          label: "概览",
          href: playerProfileHref(userId, query, "overview", fromStats),
          active: section === "overview",
        },
        {
          label: "比赛",
          href: playerMatchesHref(
            userId,
            { ...query, page: 1, cursor: "", direction: "older" },
            fromStats,
          ),
          active: section === "matches",
        },
        {
          label: "统计",
          href: playerProfileHref(userId, query, "stats", fromStats),
          active: section === "stats",
        },
        {
          label: "资料 / 履历",
          href: playerProfileHref(userId, query, "profile", fromStats),
          active: section === "profile",
        },
      ]}
    />
  );
}
