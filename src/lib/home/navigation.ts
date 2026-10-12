import { seasonEntries } from "@/lib/seasons/entries";
import type { RegistrationMode, SeasonStatus } from "@/types/season";
import { getSeasonLifecycleGroup, isRegistrationActuallyOpen } from "@/lib/seasons/presentation";
import { showStats } from "@/lib/utils/season";
import { getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";
import { presentSeasonParticipationState } from "@/lib/seasons/presentation";

export interface FeaturedSeasonInput {
  id: string;
  status: SeasonStatus;
  registrationOpenedAt?: Date | string | null;
  lastCompletedAt?: Date | string | null;
  hasOfficialMatches?: boolean;
}

export interface HomeNavSeason extends RegistrationWindowSeason {
  hasOfficialMatches?: boolean;
  competitionTemplate?: string;
  hasMatches?: boolean;
  stagePlan?: readonly unknown[];
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
        if (completedAtDifference) return completedAtDifference;
      } else {
        const openedAtDifference = getTimestamp(b.season.registrationOpenedAt) - getTimestamp(a.season.registrationOpenedAt);
        if (openedAtDifference) return openedAtDifference;
      }

      const idDifference = a.season.id.localeCompare(b.season.id);
      return idDifference !== 0 ? idDifference : a.index - b.index;
    })
    .map((entry) => entry.season)[0];
}

/** A navigation shortcut only; never use it to infer a match's ownership. */
export function selectActiveSeason<T extends FeaturedSeasonInput>(seasons: readonly T[]): T | undefined {
  return selectFeaturedSeason(seasons.filter((season) => getSeasonLifecycleGroup(season) === "active"));
}

function getFeaturedSeasonPriority(season: FeaturedSeasonInput): number | null {
  if (season.hasOfficialMatches && !["draft", "finished", "archived"].includes(season.status)) return 0;
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
  season: RegistrationWindowSeason & { slug: string },
  now: Date = new Date(),
): HomeEyebrow {
  const { status, slug } = season;
  if (status === "registration") {
    const participation = presentSeasonParticipationState(season, now);
    return { text: `● ${participation.label}`, color: participation.tone === "success" ? "var(--color-ok)" : participation.tone === "warn" ? "var(--color-warn)" : "var(--color-fg-mid)" };
  }
  if (status === "voting") {
    return { text: "● 队长投票中", color: "var(--color-warn)" };
  }
  if (status === "drafting") {
    return { text: "● 选秀阶段", color: "var(--color-accent)" };
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
  now: Date = new Date(),
): HomeNavEntry[] {
  const isHistorical = season.status === "finished" || season.status === "archived";
  const entries: (HomeNavEntry & { show: boolean })[] = [
    { key: "register", href: `/${season.slug}/register`, label: "报名", mono: "REGISTER", meta: season.registrationMode === "team" ? "组队参赛" : "个人报名", show: getRegistrationWindowState(season, now).canSubmit && !season.hasOfficialMatches },
    ...seasonEntries({ ...season, hasMatches: season.hasMatches ?? (season.stagePlan ? season.stagePlan.length > 0 : true), hasStats: showStats(season), hasPredictions: season.competitionTemplate === "major" }).filter(entry => entry.key !== "overview").map(entry => ({ key: entry.key, href: entry.href, label: entry.label, mono: entry.key.toUpperCase(), meta: entry.key === "draft" ? isHistorical ? "选人回顾" : "阵容与选人进度" : entry.key === "captains" ? isHistorical ? "结果已归档" : "候选与真实票数" : entry.key === "bet" ? "免费预测 · 积分竞猜" : entry.key === "predictions" ? "自由推演 · Pick’Em" : "", show: entry.canRead })),
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
  const tier1Key = status === "registration" && !entries.some(entry => entry.key === "register") ? "matches" : getPrimaryNavKey(status);
  const tier1Entry = tier1Key
    ? entries.find((entry) => entry.key === tier1Key) ?? null
    : null;

  const tier2Candidates = entries.filter(
    (entry) => entry.key !== tier1Key && entry.key !== "login" && entry.key !== "seasons"
  );

  return {
    tier1Entry,
    tier2Entries: tier2Candidates.filter(entry => ["matches", "bet", "predictions", "stats", "captains", "draft"].includes(entry.key)),
    tier3Entries: [
      ...tier2Candidates.filter(entry => !["matches", "bet", "predictions", "stats", "captains", "draft"].includes(entry.key)),
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
