import { describe, expect, it } from "vitest";
import { createMajorBrowserScenario, MAJOR_BROWSER_PROFILE_ACCOUNT_KEYS } from "../../../scripts/db/major-browser-fixture";
import { MAX_TEAM_NAME_LENGTH, teamNameSchema } from "../../../src/lib/config/team-config";

describe("Major browser fixture profile contract", () => {
  it("generates short constrained values from the production fixture contract", () => {
    const scenario = createMajorBrowserScenario("e2e-team-invitation-with-a-long-diagnostic-scenario-id", "team-invite");
    const inviteeTeam = scenario.invitationTeam;
    const player2 = scenario.accounts.find((account) => account.key === "player2");

    expect(scenario.shortKey).toMatch(/^[0-9a-f]{12}$/);
    expect(teamNameSchema.safeParse(inviteeTeam.name).success).toBe(true);
    expect(inviteeTeam.name.length).toBeLessThanOrEqual(MAX_TEAM_NAME_LENGTH);
    expect(inviteeTeam.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(scenario.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(scenario.accounts).toHaveLength(MAJOR_BROWSER_PROFILE_ACCOUNT_KEYS["team-invite"].length);
    expect(scenario.accounts.every((account) => account.email.length <= 320 && /^[^@\s]+@[^@\s]+$/.test(account.email))).toBe(true);
    expect(inviteeTeam.captainUserId).toBe(player2?.userId);
  });

  it("keeps each browser flow on the smallest declared account profile", () => {
    expect(createMajorBrowserScenario("profile-auth", "auth").accounts.map(({ key }) => key)).toEqual(["player3"]);
    expect(createMajorBrowserScenario("profile-major", "major-entry").accounts.map(({ key }) => key)).toEqual(["captain"]);
    expect(createMajorBrowserScenario("profile-education", "education").accounts.map(({ key }) => key)).toEqual(["player1", "admin"]);
    expect(createMajorBrowserScenario("profile-major-qualification", "major-qualification").accounts.map(({ key }) => key)).toEqual(["admin"]);
  });
});
