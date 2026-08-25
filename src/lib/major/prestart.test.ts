import { describe, expect, it } from "vitest";
import { createMajorDefaultCapabilities } from "@/types/season";
import {
  evaluateMajorPrestartReadiness,
  type MajorPrestartReadinessInput,
} from "./prestart";

const teamIds = Array.from({ length: 32 }, (_, index) => `team-${index + 1}`);

function makeInput(): MajorPrestartReadinessInput {
  return {
    capabilities: createMajorDefaultCapabilities(),
    teams: teamIds.map((teamId, teamIndex) => ({
      teamId,
      playerIds: Array.from({ length: 5 }, (_, playerIndex) => `player-${teamIndex * 5 + playerIndex + 1}`),
    })),
    confirmations: teamIds.map((teamId) => ({ teamId, confirmed: true })),
    qualificationIssues: [],
    administrativeIssues: [],
    tournamentSeeds: teamIds.map((teamId, index) => ({ teamId, tournamentSeed: index + 1 })),
    reconfirmations: teamIds.map((teamId) => ({ teamId, confirmed: true })),
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
    input.reconfirmations = input.reconfirmations!.slice(0, 30);

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
    expect(result.blockers.join("\n")).toContain("缺少赛前重新确认记录");
  });

  it("fails closed when schema-less facts are not connected", () => {
    const input = makeInput();
    input.confirmations = null;
    input.qualificationIssues = null;
    input.administrativeIssues = null;
    input.tournamentSeeds = null;
    input.reconfirmations = null;

    const result = evaluateMajorPrestartReadiness(input);

    expect(result.canStart).toBe(false);
    expect(result.openingPlan).toBeNull();
    expect(result.checks.filter((check) => check.state === "unavailable").map((check) => check.key)).toEqual([
      "confirmations", "qualification", "administration", "seeds", "reconfirmations",
    ]);
    expect(result.blockers.every((blocker) => blocker.includes("尚未接入/不可确认") || blocker.includes("开赛计划"))).toBe(true);
  });
});
