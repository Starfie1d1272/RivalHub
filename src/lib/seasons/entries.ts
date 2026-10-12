import { statsEntryHref } from "@/lib/stats/view-state";
import type { SeasonStatus } from "@/types/season";

export type SeasonEntryKey = "overview" | "captains" | "draft" | "matches" | "teams" | "players" | "stats" | "bet" | "predictions" | "awards" | "info";
export interface SeasonEntry {
  key: SeasonEntryKey;
  label: string;
  href: string;
  scope: "event" | "platform";
  canRead: boolean;
  canAct: boolean;
  featuredPriority: number;
  matches: (pathname: string) => boolean;
}
export interface SeasonEntryInput {
  slug: string;
  status: SeasonStatus;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasCommunityAwards?: boolean;
  hasMatches: boolean;
  hasStats: boolean;
  hasPredictions?: boolean;
}
/** Presentation metadata only: authorization and transitions stay with their owners. */
export function seasonEntries(input: SeasonEntryInput): SeasonEntry[] {
  const { slug, status } = input;
  const rows: [SeasonEntryKey, string, string, boolean, number][] = [
    ["overview", "总览", `/${slug}`, true, 9],
    ["captains", "队长投票", `/${slug}/captains`, input.hasCaptainVoting, status === "voting" ? 0 : 5],
    ["draft", "选秀", `/${slug}/draft`, input.hasDraft, status === "drafting" ? 0 : 5],
    ["matches", "赛程", `/${slug}/matches`, input.hasMatches, 1],
    ["teams", "队伍", `/${slug}/teams`, true, 4],
    ["players", "选手", `/${slug}/players`, true, 4],
    ["stats", "数据", statsEntryHref(slug, {}, status === "draft"), input.hasStats, 3],
    ["bet", "预测与竞猜", `/${slug}/bet`, Boolean(input.hasPredictions), 2],
    ["predictions", "赛事推演", `/${slug}/predictions`, Boolean(input.hasPredictions), 2],
    ["awards", "社区奖", `/${slug}/community-awards`, Boolean(input.hasCommunityAwards), 6],
    ["info", "赛事信息", `/${slug}/info`, true, 8],
  ];
  return rows.map(([key, label, href, canRead, featuredPriority]) => ({
    key, label, href, canRead, featuredPriority,
    scope: key === "stats" ? "platform" : "event",
    canAct: key === "captains" ? status === "voting" : key === "draft" ? status === "drafting" : false,
    matches: (pathname: string) => key === "overview" ? pathname === href
      : key === "info" ? pathname === href || pathname.startsWith(`${href}/`) || pathname === `/${slug}/announcements`
      : pathname === href || pathname.startsWith(`${href}/`),
  }));
}
