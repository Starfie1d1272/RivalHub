import { describe, expect, it } from "vitest";
import { createMajorDefaultCapabilities } from "@/types/season";
import {
  evaluateMajorPrestartReadiness,
  type MajorPrestartReadinessInput,
} from "./prestart";

const teamIds = Array.from({ length: 32 }, (_, index) => `team-${index + 1}`);

function makeInput(): MajorPrestartReadinessInput {
  return {
    competitionTemplate: "major",
    capabilities: createMajorDefaultCapabilities(),
    teams: teamIds.map((teamId, teamIndex) => ({
      teamId,
      playerIds: Array.from({ length: 5 }, (_, playerIndex) => `player-${teamIndex * 5 + playerIndex + 1}`),
      educationVerificationIds: Array.from({ length: 5 }, (_, playerIndex) => `verification-${teamIndex * 5 + playerIndex + 1}`),
    })),
    entrantsLocked: true,
    confirmations: teamIds.map((teamId) => ({ teamId, confirmed: true })),
    qualificationIssues: [],
    administrativeIssues: [],
    tournamentSeeds: teamIds.map((teamId, index) => ({ teamId, tournamentSeed: index + 1 })),
    seedConfirmation: { seedRevision: 1, confirmedSeedRevision: 1 },
  };
}

describe("evaluateMajorPrestartReadiness", () => {
  it("returns a startable domain result and opening plan for complete factual input", () => {
    const result = evaluateMajorPrestartReadiness(makeInput());

    expect(result.canStart).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.openingPlan?.firstRound.pairings).toHaveLength(8);
    expect(result.checks.every((check) => check.state === "ready")).toBe(true);
  });

  it("blocks a Major-shaped custom template before managed runtime checks", () => {
    const input = makeInput();
    input.competitionTemplate = "custom";

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.openingPlan).toBeNull();
    expect(result.checks.find((check) => check.key === "rules")).toMatchObject({
      state: "blocked",
      blockers: ["当前赛事模板不是 major，不能进入 Major runtime。"],
    });
  });

  it("returns Chinese blockers instead of throwing for ordinary incomplete conditions", () => {
    const input = makeInput();
    input.capabilities.hasDraft = true;
    input.teams = input.teams!.slice(0, 31).map((team, index) => (
      index === 0 ? { ...team, playerIds: [team.playerIds[0]!, team.playerIds[1]!, "player-6"] } : team
    ));
    input.confirmations = input.confirmations!.map((fact, index) => ({ ...fact, confirmed: index !== 0 }));
    input.qualificationIssues = [{ label: "资格材料复核", resolved: false }];
    input.administrativeIssues = [{ label: "裁判排班", resolved: false }];
    input.tournamentSeeds = input.tournamentSeeds!.map((fact, index) => (
      index === 31 ? { ...fact, tournamentSeed: 31 } : fact
    ));
    input.seedConfirmation = { seedRevision: 2, confirmedSeedRevision: 1 };

    expect(() => evaluateMajorPrestartReadiness(input)).not.toThrow();
    const result = evaluateMajorPrestartReadiness(input);
    expect(result.canStart).toBe(false);
    expect(result.openingPlan).toBeNull();
    expect(result.blockers.join("\n")).toContain("Major 开赛需要恰好 32 支队伍");
    expect(result.blockers.join("\n")).toContain("名单不足 5 人");
    expect(result.checks.find((check) => check.key === "duplicate-players")?.state).toBe("blocked");
    expect(result.blockers.join("\n")).toContain("尚未参赛确认");
    expect(result.blockers.join("\n")).toContain("资格事项未完成");
    expect(result.blockers.join("\n")).toContain("管理事项未完成");
    expect(result.blockers.join("\n")).toContain("赛事种子 32 尚未分配");
    expect(result.blockers.join("\n")).toContain("赛事种子已变化，必须重新确认");
  });

  it("fails closed when schema-less facts are not connected", () => {
    const input = makeInput();
    input.confirmations = null;
    input.qualificationIssues = null;
    input.administrativeIssues = null;
    input.tournamentSeeds = null;
    input.entrantsLocked = null;
    input.seedConfirmation = null;

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.openingPlan).toBeNull();
    expect(result.checks.filter((check) => check.state === "unavailable").map((check) => check.key)).toEqual([
      "entrants-locked", "confirmations", "qualification", "administration", "seeds", "reconfirmations",
    ]);
    expect(result.blockers.every((blocker) => blocker.includes("尚未接入/不可确认") || blocker.includes("开赛计划"))).toBe(true);
  });

  it("blocks start when a frozen roster entry lacks its approved verification reference", () => {
    const input = makeInput();
    input.teams = input.teams!.map((team, index) => index === 0
      ? { ...team, educationVerificationIds: [null, ...team.educationVerificationIds.slice(1)] }
      : team);

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.blockers.join("\n")).toContain("未冻结的教育认证依据");
  });

  it("blocks start when verification references do not match roster length", () => {
    const input = makeInput();
    input.teams = input.teams!.map((team, index) => index === 0
      ? { ...team, educationVerificationIds: team.educationVerificationIds.slice(1) }
      : team);

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.blockers.join("\n")).toContain("未冻结的教育认证依据");
  });

  it.each([
    ["minimum team size", (input: MajorPrestartReadinessInput) => { input.capabilities.minTeamSize = 0; }, "最小名单人数"],
    ["maximum team size below minimum", (input: MajorPrestartReadinessInput) => { input.capabilities.maxTeamSize = 4; }, "最大名单人数"],
    ["zero starters", (input: MajorPrestartReadinessInput) => { input.capabilities.starterCount = 0; }, "首发人数"],
    ["starters above maximum roster", (input: MajorPrestartReadinessInput) => { input.capabilities.starterCount = 10; }, "首发人数"],
    ["roster above maximum", (input: MajorPrestartReadinessInput) => {
      input.teams = input.teams!.map((team, index) => index === 0
        ? { ...team, playerIds: [...team.playerIds, "player-extra", "player-extra-2", "player-extra-3", "player-extra-4", "player-extra-5"], educationVerificationIds: [...team.educationVerificationIds, "verification-extra", "verification-extra-2", "verification-extra-3", "verification-extra-4", "verification-extra-5"] }
        : team);
    }, "名单超过上限"],
    ["roster cannot form starters", (input: MajorPrestartReadinessInput) => {
      input.capabilities.starterCount = 6;
    }, "无法组成 6 名首发"],
  ] as const)("blocks invalid roster policy: %s", (_name, mutate, expected) => {
    const input = makeInput();
    mutate(input);

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.checks.find((check) => check.key === "rosters")?.state).toBe("blocked");
    expect(result.blockers.join("\n")).toContain(expected);
  });

  it("constructs a preview from valid team identities and seeds before start authorization is ready", () => {
    const input = makeInput();
    input.teams = input.teams!.map((team) => ({ ...team, playerIds: [], educationVerificationIds: [] }));
    input.entrantsLocked = false;
    input.confirmations = input.confirmations!.map((fact) => ({ ...fact, confirmed: false }));
    input.qualificationIssues = [{ label: "资格材料复核", resolved: false }];
    input.administrativeIssues = [{ label: "裁判排班", resolved: false }];
    input.seedConfirmation = null;

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.openingPlan).not.toBeNull();
    expect(result.openingPlan?.firstRound.pairings).toHaveLength(8);
    expect(result.checks.find((check) => check.key === "opening-plan")).toMatchObject({ state: "ready", blockers: [] });
  });
});
