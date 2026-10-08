import { describe, expect, it } from "vitest";
import {
  buildHomeNavEntries,
  selectFeaturedSeason,
  selectActiveSeason,
  selectHomeNavTiers,
} from "./navigation";

const registrationWindow = {
  registrationOpensAt: new Date("2000-08-01T00:00:00.000Z"),
  registrationClosesAt: null,
};

function featuredSeason(overrides: Partial<{
  id: string;
  status: "draft" | "registration" | "voting" | "drafting" | "playing" | "finished" | "archived";
  registrationOpenedAt: Date | null;
  createdAt: Date;
}> = {}) {
  return {
    id: "season-1",
    status: "finished" as const,
    registrationOpenedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("featured season selector", () => {
  it("does not use upcoming, draft or historical events as an active navigation shortcut", () => {
    const inactive = (["draft", "registration", "finished", "archived"] as const)
      .map((status) => featuredSeason({ id: status, status }));
    expect(selectActiveSeason(inactive)).toBeUndefined();
    const registration = featuredSeason({ id: "open", status: "registration", registrationOpenedAt: new Date("2026-01-01") });
    expect(selectActiveSeason([...inactive, registration])?.id).toBe("open");
  });

  it("selects one active event using homepage priority regardless of catalog order", () => {
    const active = [
      featuredSeason({ id: "open", status: "registration", registrationOpenedAt: new Date("2026-02-01") }),
      featuredSeason({ id: "playing", status: "playing" }),
      featuredSeason({ id: "voting", status: "voting" }),
    ];
    expect(selectActiveSeason(active)?.id).toBe("playing");
    expect(selectActiveSeason([...active].reverse())?.id).toBe("playing");
  });

  it("prefers a published but not-yet-open season over an older finished season", () => {
    const finished = featuredSeason({
      id: "finished",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const upcoming = featuredSeason({
      id: "upcoming",
      status: "registration",
      registrationOpenedAt: null,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(selectFeaturedSeason([finished, upcoming])?.id).toBe("upcoming");
  });

  it("uses the declared priority before recency and excludes archived seasons", () => {
    const oldPlaying = featuredSeason({
      id: "playing",
      status: "playing",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newerRegistration = featuredSeason({
      id: "registration",
      status: "registration",
      registrationOpenedAt: new Date("2026-02-01T00:00:00.000Z"),
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    const newestArchived = featuredSeason({
      id: "archived",
      status: "archived",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    expect(selectFeaturedSeason([newestArchived, newerRegistration, oldPlaying])?.id).toBe("playing");
  });

  it("uses a stable identity tie breaker when no operational date exists", () => {
    const older = featuredSeason({
      id: "older",
      status: "voting",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = featuredSeason({
      id: "newer",
      status: "drafting",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(selectFeaturedSeason([older, newer])?.id).toBe("newer");
  });
});

describe("home navigation helpers", () => {
  it("prioritizes registration when a solo season is registering", () => {
    const entries = buildHomeNavEntries({
      ...registrationWindow,
      slug: "nju-rivals-2026",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      status: "registration",
      registrationOpenedAt: new Date("2026-08-01T00:00:00.000Z"),
    }, { isAuthenticated: false });
    const tiers = selectHomeNavTiers(entries, "registration");

    expect(tiers.tier1Entry?.key).toBe("register");
    expect(tiers.tier2Entries.map((entry) => entry.key)).toEqual([
      "captains",
      "draft",
      "teams",
      "matches",
    ]);
    expect(tiers.tier3Entries.map((entry) => entry.key)).toEqual([
      "players",
      "seasons",
      "login",
    ]);
  });

  it("keeps team registration discoverable when the season does not support draft-era capabilities", () => {
    const entries = buildHomeNavEntries({
      ...registrationWindow,
      slug: "open-cup",
      registrationMode: "team",
      hasCaptainVoting: false,
      hasDraft: false,
      status: "registration",
      registrationOpenedAt: new Date("2026-08-01T00:00:00.000Z"),
    }, { isAuthenticated: false });

    expect(entries.map((entry) => entry.key)).toEqual([
      "register",
      "teams",
      "matches",
      "players",
      "seasons",
      "login",
    ]);
  });

  it("uses an explicit auth state for the account entry", () => {
    const season = {
      ...registrationWindow,
      slug: "nju-rivals-2026",
      registrationMode: "solo" as const,
      hasCaptainVoting: true,
      hasDraft: true,
      status: "registration" as const,
    };

    expect(buildHomeNavEntries(season, { isAuthenticated: false }).find((entry) => entry.key === "login")).toMatchObject({
      href: "/login",
      label: "登录 / 注册",
    });
    expect(buildHomeNavEntries(season, { isAuthenticated: true }).find((entry) => entry.key === "login")).toMatchObject({
      href: "/my",
      label: "我的",
    });
  });

  it("turns off proactive registration and labels finished entries as history", () => {
    const entries = buildHomeNavEntries({
      ...registrationWindow,
      slug: "finished-season",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      status: "finished",
    }, { isAuthenticated: false });

    expect(entries.some((entry) => entry.key === "register")).toBe(false);
    expect(entries.find((entry) => entry.key === "captains")).toMatchObject({ label: "队长投票", meta: "结果已归档" });
    expect(entries.find((entry) => entry.key === "draft")).toMatchObject({ label: "选秀", meta: "选人回顾" });
    expect(entries.map((entry) => entry.key)).toContain("teams");
    expect(entries.map((entry) => entry.key)).toContain("matches");
    expect(entries.map((entry) => entry.key)).toContain("stats");
  });
});
