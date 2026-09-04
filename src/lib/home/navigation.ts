import type { RegistrationMode, SeasonStatus } from "@/types/season";
import { getSeasonLifecycleGroup, isRegistrationActuallyOpen } from "@/lib/seasons/presentation";

export interface FeaturedSeasonInput {
  id: string;
  status: SeasonStatus;
  registrationOpenedAt?: Date | string | null;
  createdAt: Date | string;
}

export interface HomeNavSeason {
  slug: string;
  registrationMode: RegistrationMode;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
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

      const createdAtDifference = getTimestamp(b.season.createdAt) - getTimestamp(a.season.createdAt);
      if (createdAtDifference !== 0) return createdAtDifference;

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
  return null;
}

function getTimestamp(value: Date | string): number {
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
      return { text: "● REGISTRATION UPCOMING", color: "var(--color-warn)" };
    }
    return { text: "● REGISTRATION OPEN", color: "var(--color-ok)" };
  }
  if (status === "voting") {
    return { text: "● CAPTAIN VOTING", color: "var(--color-warn)" };
  }
  if (status === "playing") {
    return { text: "● SEASON IN PROGRESS", color: "var(--color-ok)" };
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
      label: season.registrationMode === "team" ? "组队报名" : "报名参赛",
      mono: "REGISTER",
      meta: season.registrationMode === "team" ? "创建或加入队伍" : "个人报名",
      show: !isHistorical && (season.status !== "registration" || isRegistrationActuallyOpen(season)),
    },
    {
      key: "captains",
      href: `/${season.slug}/captains`,
      label: isHistorical ? "队长投票结果" : "队长投票",
      mono: "CAPTAINS",
      meta: isHistorical ? "最终结果" : "实时票数",
      show: season.hasCaptainVoting,
    },
    {
      key: "draft",
      href: `/${season.slug}/draft`,
      label: isHistorical ? "选秀回顾" : "选秀直播间",
      mono: "DRAFT ROOM",
      meta: isHistorical ? "完整选人记录" : "● LIVE",
      show: season.hasDraft,
    },
    {
      key: "teams",
      href: `/${season.slug}/teams`,
      label: "战队阵容",
      mono: "TEAMS",
      meta: "战队展示",
      show: true,
    },
    {
      key: "matches",
      href: `/${season.slug}/matches`,
      label: "赛程对决",
      mono: "MATCHES",
      meta: "Bracket · 赛果",
      show: true,
    },
    {
      key: "stats",
      href: `/${season.slug}/stats`,
      label: "数据排行",
      mono: "STATS",
      meta: "Rating · ADR",
      show: true,
    },
    {
      key: "seasons",
      href: "/seasons",
      label: "历史赛季",
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
  if (status === "playing") return "matches";
  return null;
}
