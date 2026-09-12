import type { RegistrationMode, SeasonStatus } from "@/types/season";
import { getSeasonLifecycleGroup, isRegistrationActuallyOpen } from "@/lib/seasons/presentation";
import { showStats } from "@/lib/utils/season";

export interface FeaturedSeasonInput {
  id: string;
  status: SeasonStatus;
  registrationOpenedAt?: Date | string | null;
  createdAt: Date | string;
  lastCompletedAt?: Date | string | null;
}

export interface HomeNavSeason {
  slug: string;
  registrationMode: RegistrationMode;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasCommunityAwards?: boolean;
  status: SeasonStatus;
  registrationOpenedAt?: Date | string | null;
}

export interface HomeNavAuthState {
  isAuthenticated: boolean;
}

export interface HomeNavEntry {
  key: string;
  href: string;
  label: string;
  mono: string;
  meta: string;
}

export interface HomeEyebrow {
  text: string;
  color: string;
}

/**
 * Choose the public homepage's primary season without creating a persisted
 * current-season singleton. Priority is a presentation concern and uses only
 * persisted lifecycle facts.
 */
export function selectFeaturedSeason<T extends FeaturedSeasonInput>(
  seasons: readonly T[],
): T | undefined {
  return seasons
    .map((season, index) => ({ season, index, priority: getFeaturedSeasonPriority(season) }))
    .filter((entry): entry is { season: T; index: number; priority: number } => entry.priority !== null)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;

      const isHistorical = a.season.status === "finished" || a.season.status === "archived";
      if (isHistorical) {
        const completedAtDifference = getTimestamp(b.season.lastCompletedAt) - getTimestamp(a.season.lastCompletedAt);
        if (completedAtDifference !== 0) return completedAtDifference;
      } else {
        const createdAtDifference = getTimestamp(b.season.createdAt) - getTimestamp(a.season.createdAt);
        if (createdAtDifference !== 0) return createdAtDifference;
      }

      const idDifference = a.season.id.localeCompare(b.season.id);
      return idDifference !== 0 ? idDifference : a.index - b.index;
    })
    .map((entry) => entry.season)[0];
}

function getFeaturedSeasonPriority(season: FeaturedSeasonInput): number | null {
  if (season.status === "playing") return 0;
  if (season.status === "voting" || season.status === "drafting") return 1;
  if (season.status === "registration") return isRegistrationActuallyOpen(season) ? 2 : 3;
  if (getSeasonLifecycleGroup(season) === "recent") return 4;
  if (season.status === "archived") return 5;
  return null;
}

function getTimestamp(value: Date | string | null | undefined): number {
  if (value == null) return Number.NEGATIVE_INFINITY;
  const timestamp = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function buildHomeEyebrow(
  status: SeasonStatus,
  slug: string,
  registrationOpenedAt?: Date | string | null,
): HomeEyebrow {
  if (status === "registration") {
    if (registrationOpenedAt == null) {
      return { text: "● 报名即将开放", color: "var(--color-warn)" };
    }
    return { text: "● 报名开放", color: "var(--color-ok)" };
  }
  if (status === "voting") {
    return { text: "● 队长投票中", color: "var(--color-warn)" };
  }
  if (status === "playing") {
    return { text: "● 比赛进行中", color: "var(--color-ok)" };
  }
  return {
    text: `[ RIVALHUB / ${slug.replace(/-/g, " ").toUpperCase()} ]`,
    color: "var(--color-accent)",
  };
}

export function buildHomeNavEntries(
  season: HomeNavSeason,
  auth?: HomeNavAuthState,
): HomeNavEntry[] {
  const isHistorical = season.status === "finished" || season.status === "archived";
  const entries: (HomeNavEntry & { show: boolean })[] = [
    {
      key: "register",
      href: `/${season.slug}/register`,
      label: "报名",
      mono: "REGISTER",
      meta: season.registrationMode === "team" ? "创建或加入队伍" : "个人报名",
      show: season.status === "registration" && isRegistrationActuallyOpen(season),
    },
    {
      key: "captains",
      href: `/${season.slug}/captains`,
      label: "队长投票",
      mono: "CAPTAINS",
      meta: isHistorical ? "结果已归档" : "实时票数",
      show: season.hasCaptainVoting,
    },
    {
      key: "draft",
      href: `/${season.slug}/draft`,
      label: "选秀",
      mono: "DRAFT ROOM",
      meta: isHistorical ? "选人回顾" : season.status === "drafting" ? "选人进行中" : "选人记录",
      show: season.hasDraft,
    },
    {
      key: "teams",
      href: `/${season.slug}/teams`,
      label: "队伍",
      mono: "TEAMS",
      meta: "赛事参赛队伍",
      show: true,
    },
    {
      key: "matches",
      href: `/${season.slug}/matches`,
      label: "赛程",
      mono: "MATCHES",
      meta: "赛程与赛果",
      show: true,
    },
    {
      key: "stats",
      href: `/${season.slug}/stats`,
      label: "数据统计",
      mono: "STATS",
      meta: "Rating · ADR",
      show: showStats(season),
    },
    { key: "players", href: `/${season.slug}/players`, label: "选手", mono: "PLAYERS", meta: "本届选手", show: true },
    { key: "awards", href: `/${season.slug}/community-awards`, label: "社区奖", mono: "AWARDS", meta: "创意与荣誉", show: Boolean(season.hasCommunityAwards) },
    {
      key: "seasons",
      href: "/seasons",
      label: "赛事中心",
      mono: "ARCHIVE",
      meta: "浏览回顾",
      show: true,
    },
    {
      key: "login",
      href: auth ? (auth.isAuthenticated ? "/my" : "/login") : "/my",
      label: auth ? (auth.isAuthenticated ? "我的" : "登录 / 注册") : "我的 RivalHub",
      mono: auth ? (auth.isAuthenticated ? "MY RIVALHUB" : "LOGIN") : "MY RIVALHUB",
      meta: auth ? (auth.isAuthenticated ? "资料与赛事" : "参赛者入口") : "资料与赛事",
      show: true,
    },
  ];
  return entries.filter((entry) => entry.show).map((entry) => ({
    key: entry.key,
    href: entry.href,
    label: entry.label,
    mono: entry.mono,
    meta: entry.meta,
  }));
}

export function selectHomeNavTiers(entries: HomeNavEntry[], status: SeasonStatus) {
  const tier1Key = getPrimaryNavKey(status);
  const tier1Entry = tier1Key
    ? entries.find((entry) => entry.key === tier1Key) ?? null
    : null;

  const tier2Candidates = entries.filter(
    (entry) => entry.key !== tier1Key && entry.key !== "login" && entry.key !== "seasons"
  );

  return {
    tier1Entry,
    tier2Entries: tier2Candidates.slice(0, 4),
    tier3Entries: [
      ...tier2Candidates.slice(4),
      ...entries.filter((entry) => entry.key === "seasons" || entry.key === "login"),
    ],
  };
}

function getPrimaryNavKey(status: SeasonStatus): string | null {
  if (status === "registration") return "register";
  if (status === "voting") return "captains";
  if (status === "drafting") return "draft";
  if (["playing", "finished", "archived"].includes(status)) return "matches";
  return null;
}
