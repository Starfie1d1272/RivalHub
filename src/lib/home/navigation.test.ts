import { describe, expect, it } from "vitest";
import {
  buildHomeEyebrow,
  buildHomeNavEntries,
  selectFeaturedSeason,
  selectHomeNavTiers,
} from "./navigation";

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

  it("uses newer creation time as the deterministic tie breaker", () => {
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
      "stats",
      "seasons",
      "login",
    ]);
  });

  it("keeps team registration discoverable when the season does not support draft-era capabilities", () => {
    const entries = buildHomeNavEntries({
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
      "stats",
      "seasons",
      "login",
    ]);
  });

  it("describes the active phase eyebrow", () => {
    expect(buildHomeEyebrow("voting", "nju-rivals-2026")).toEqual({
      text: "● CAPTAIN VOTING",
      color: "var(--color-warn)",
    });

    expect(buildHomeEyebrow("finished", "nju-rivals-2026")).toEqual({
      text: "[ RIVALHUB / NJU RIVALS 2026 ]",
      color: "var(--color-accent)",
    });
    expect(buildHomeEyebrow("registration", "nju-rivals-2026", null)).toEqual({
      text: "● REGISTRATION UPCOMING",
      color: "var(--color-warn)",
    });
  });

  it("uses an explicit auth state for the account entry", () => {
    const season = {
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
      slug: "finished-season",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      status: "finished",
    }, { isAuthenticated: false });

    expect(entries.some((entry) => entry.key === "register")).toBe(false);
    expect(entries.find((entry) => entry.key === "captains")).toMatchObject({ label: "队长投票结果" });
    expect(entries.find((entry) => entry.key === "draft")).toMatchObject({ label: "选秀回顾" });
    expect(entries.map((entry) => entry.key)).toContain("teams");
    expect(entries.map((entry) => entry.key)).toContain("matches");
    expect(entries.map((entry) => entry.key)).toContain("stats");
  });
});
