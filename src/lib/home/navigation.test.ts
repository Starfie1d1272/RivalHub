import { describe, expect, it } from "vitest";
import {
  buildHomeEyebrow,
  buildHomeNavEntries,
  selectHomeNavTiers,
} from "./navigation";

describe("home navigation helpers", () => {
  it("prioritizes registration when a solo season is registering", () => {
    const entries = buildHomeNavEntries({
      slug: "nju-rivals-2026",
      registrationMode: "solo",
      hasCaptainVoting: true,
      hasDraft: true,
      status: "registration",
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
      href: "/settings",
      label: "个人中心",
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
