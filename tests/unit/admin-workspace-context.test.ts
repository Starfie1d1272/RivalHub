import { describe, expect, it } from "vitest";
import { resolveMatchReturnContext } from "@/lib/admin/matches/return-context";
import { selectSeasonWorkspaceNextAction } from "@/lib/admin/season-workspace/selectors";
import { getSeasonAdminNavigation } from "@/lib/admin/navigation";

const summary = { pendingApplications: 2, approvedEntries: 4, formedTeamCount: 4, entrantCount: 4, frozenEntrantCount: 0, matchCount: 8, scheduledMatchesWithoutConfirmedLineups: 0, finalResultPendingConfirmation: false, activeAdjudications: 0 };
describe("admin work context", () => {
  it("keeps the planning filters and row anchor when returning from a match", () => {
    const href = "/admin/major/matches?view=schedule&stage=play-in&team=one#match-two";
    expect(resolveMatchReturnContext("major", href, false)).toEqual({ href, label: "回到赛程与阶段" });
  });
  it.each(["https://evil.example", "//evil.example", "/admin/other/matches", "/admin/major/../other/matches", "/admin/major/matches/another", "/admin/major\\evil"])("rejects a foreign or recursive return destination: %s", value => {
    expect(resolveMatchReturnContext("major", value, false).href).toBe("/admin/major/matches");
  });
  it("does not let existing qualification or historical matches hide registration work", () => {
    expect(selectSeasonWorkspaceNextAction({ slug: "major", status: "registration", registrationOpenedAt: new Date() }, summary, null).href).toBe("/admin/major/registrations");
  });
  it("sends an already started event without matches to scheduling", () => {
    expect(selectSeasonWorkspaceNextAction({ slug: "major", status: "playing", registrationOpenedAt: new Date() }, { ...summary, matchCount: 0 }, null).href).toBe("/admin/major/matches?view=schedule");
  });
  it("shares event work while keeping super-admin settings out of the season-admin navigation", () => {
    const season = { id: "1", slug: "major", name: "Major", competitionTemplate: "major", hasCaptainVoting: false, hasDraft: false, hasCommunityAwards: true };
    const links = getSeasonAdminNavigation(season, "season_admin").flatMap(g => g.items.map(i => i.href));
    expect(links).toContain("/admin/major/announcements");
    expect(links).not.toContain("/admin/major/settings");
    expect(getSeasonAdminNavigation(season, "super_admin").flatMap(g => g.items.map(i => i.href))).toContain("/admin/major/settings");
  });
});
