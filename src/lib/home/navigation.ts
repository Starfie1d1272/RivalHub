import type { RegistrationMode, SeasonStatus } from "@/types/season";

export interface HomeNavSeason {
  slug: string;
  registrationMode: RegistrationMode;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
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

export function buildHomeEyebrow(status: SeasonStatus, slug: string): HomeEyebrow {
  if (status === "registration") {
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

export function buildHomeNavEntries(season: HomeNavSeason): HomeNavEntry[] {
  return [
    {
      key: "register",
      href: `/${season.slug}/register`,
      label: "报名参赛",
      mono: "REGISTER",
      meta: "个人报名",
      show: season.registrationMode === "solo",
    },
    {
      key: "captains",
      href: `/${season.slug}/captains`,
      label: "队长投票",
      mono: "CAPTAINS",
      meta: "实时票数",
      show: season.hasCaptainVoting,
    },
    {
      key: "draft",
      href: `/${season.slug}/draft`,
      label: "选秀直播间",
      mono: "DRAFT ROOM",
      meta: "● LIVE",
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
      href: "/login",
      label: "登录后台",
      mono: "LOGIN",
      meta: "管理员 · 队长",
      show: true,
    },
  ].filter((entry) => entry.show);
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
