import { describe, expect, it } from "vitest";
import { buildHomeNavEntries, buildSeasonPrimaryAction, selectHomeNavTiers, type HomeNavSeason } from "@/lib/home/navigation";
import { seasonEntries } from "./entries";
// Protect capability-gated destinations and the permanent Rivals archive entry points.
describe("season entry capability contract", () => {
  it("keeps voting and draft destinations readable after completion", () => {
    const entries = seasonEntries({ slug: "rivals", status: "archived", hasCaptainVoting: true, hasDraft: true, hasMatches: true, hasStats: true });
    expect(entries.filter(row => row.canRead).map(row => row.key)).toContain("captains");
    expect(entries.find(row => row.key === "draft")).toMatchObject({ href: "/rivals/draft", canRead: true, canAct: false });
  });
  it("does not manufacture draft or prediction capabilities", () => {
    const entries = seasonEntries({ slug: "custom", status: "playing", hasCaptainVoting: false, hasDraft: false, hasMatches: false, hasStats: false });
    expect(entries.filter(row => row.canRead).map(row => row.key)).toEqual(["overview", "teams", "players", "info"]);
    expect(entries[0]!.matches("/custom-other")).toBe(false);
  });
});

// A stage plan or lifecycle label alone must not send the primary CTA to unavailable work.
describe("season primary action", () => {
  const now = new Date("2026-10-18T06:00:00Z");
  const season: HomeNavSeason = {
    slug: "major",
    status: "registration",
    registrationMode: "team",
    registrationOpensAt: new Date("2026-10-01T00:00:00Z"),
    registrationOpenedAt: new Date("2026-10-01T00:00:00Z"),
    registrationClosesAt: new Date("2026-11-01T00:00:00Z"),
    hasCaptainVoting: false,
    hasDraft: false,
    hasOfficialMatches: false,
    hasMatches: false,
  };

  it.each([
    { registrationOpensAt: null, registrationOpenedAt: null },
    { registrationOpensAt: new Date("2026-10-20T00:00:00Z"), registrationOpenedAt: null },
    { registrationOpenedAt: null },
  ])("offers event information until registration has actually opened: %j", (window) => {
    expect(buildSeasonPrimaryAction({ ...season, ...window, hasMatches: true, stagePlan: [{}] }, now))
      .toEqual({ key: "info", href: "/major/info", label: "查看赛事信息" });
  });

  it.each([
    ["team", "组队报名"],
    ["solo", "个人报名"],
  ] as const)("offers the open %s registration path", (registrationMode, label) => {
    expect(buildSeasonPrimaryAction({ ...season, registrationMode }, now))
      .toEqual({ key: "register", href: "/major/register", label });
  });

  it("shows the teams after the deadline when no official matches exist", () => {
    expect(buildSeasonPrimaryAction({ ...season, registrationClosesAt: now, hasMatches: true }, now))
      .toMatchObject({ key: "teams", href: "/major/teams" });
  });

  it("prioritizes official Play-in matches while the main event still has registration status", () => {
    expect(buildSeasonPrimaryAction({ ...season, hasOfficialMatches: true }, now))
      .toEqual({ key: "matches", href: "/major/matches", label: "查看赛程" });
  });

  it.each([
    ["voting", "hasCaptainVoting", "captains"],
    ["drafting", "hasDraft", "draft"],
  ] as const)("only promotes the %s workflow when its capability is enabled", (status, capability, key) => {
    const current = { ...season, status };
    expect(buildSeasonPrimaryAction(current, now)).toMatchObject({ key: "info", href: "/major/info" });
    expect(buildSeasonPrimaryAction({ ...current, [capability]: true }, now))
      .toMatchObject({ key, href: `/major/${key}` });
  });

  it("does not treat a playing status or stage plan as an existing match", () => {
    expect(buildSeasonPrimaryAction({ ...season, status: "playing", hasMatches: true, stagePlan: [{}] }, now))
      .toMatchObject({ key: "teams", href: "/major/teams" });
  });

  it.each(["finished", "archived"] as const)("keeps %s review on the overview when no official matches exist", (status) => {
    expect(buildSeasonPrimaryAction({ ...season, status }, now))
      .toEqual({ key: "overview", href: "/major", label: "赛事回顾" });
    expect(buildSeasonPrimaryAction({ ...season, status, hasOfficialMatches: true }, now))
      .toEqual({ key: "matches", href: "/major/matches", label: "赛事回顾" });
  });

  it("uses the same action in home tiers, including an overview absent from the menu", () => {
    const historical = { ...season, status: "archived" as const };
    const action = buildSeasonPrimaryAction(historical, now);
    const tiers = selectHomeNavTiers(buildHomeNavEntries(historical, undefined, now), historical.status, action);
    expect(tiers.tier1Entry).toMatchObject(action);
    expect([...tiers.tier2Entries, ...tiers.tier3Entries].some(entry => entry.key === action.key)).toBe(false);

    const upcoming = { ...season, registrationOpenedAt: null };
    const upcomingAction = buildSeasonPrimaryAction(upcoming, now);
    expect(selectHomeNavTiers(buildHomeNavEntries(upcoming, undefined, now), upcoming.status, upcomingAction).tier1Entry)
      .toMatchObject(upcomingAction);
  });
});
