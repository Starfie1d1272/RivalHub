import { describe, expect, it } from "vitest";
import {
  deriveCurrentVetoTurn,
  deriveHigherSeedEntry,
  getVetoTurnDefinitions,
  projectVetoMapPlan,
} from "../veto-sequence";

describe("veto room domain", () => {
  it("derives qualification privileged entry from frozen preliminary seeds, independent of entry order", () => {
    expect(deriveHigherSeedEntry({
      entryAId: "entry-a",
      entryBId: "entry-b",
      entrants: [
        { entryId: "entry-a", seed: 8 },
        { entryId: "entry-b", seed: 2 },
      ],
    })).toBe("entry-b");
    expect(deriveHigherSeedEntry({
      entryAId: "entry-a",
      entryBId: "entry-b",
      entrants: [
        { entryId: "entry-b", seed: 2 },
        { entryId: "entry-a", seed: 8 },
      ],
    })).toBe("entry-b");
  });

  it("fails closed when frozen seed facts are incomplete, tied, invalid, or outside the match", () => {
    const base = { entryAId: "entry-a", entryBId: "entry-b" };
    expect(deriveHigherSeedEntry({ ...base, entrants: [{ entryId: "entry-a", seed: 1 }] })).toBeNull();
    expect(deriveHigherSeedEntry({ ...base, entrants: [{ entryId: "entry-a", seed: 1 }, { entryId: "entry-b", seed: 1 }] })).toBeNull();
    expect(deriveHigherSeedEntry({ ...base, entrants: [{ entryId: "entry-a", seed: 0 }, { entryId: "entry-b", seed: 2 }] })).toBeNull();
    expect(deriveHigherSeedEntry({ ...base, entrants: [{ entryId: "entry-a", seed: 1 }, { entryId: "entry-c", seed: 2 }] })).toBeNull();
  });

  it.each([
    ["bo1", ["ban:veto_a:2", "ban:veto_b:3", "ban:veto_a:1", "decider:system:1", "side_pick:veto_b:1"]],
    ["bo3", ["ban:veto_a:1", "ban:veto_b:1", "pick:veto_a:1", "side_pick:veto_b:1", "pick:veto_b:1", "side_pick:veto_a:1", "ban:veto_b:1", "ban:veto_a:1", "decider:system:1", "side_pick:veto_b:1"]],
    ["bo5", ["ban:veto_a:1", "ban:veto_b:1", "pick:veto_a:1", "side_pick:veto_b:1", "pick:veto_b:1", "side_pick:veto_a:1", "pick:veto_a:1", "side_pick:veto_b:1", "pick:veto_b:1", "side_pick:veto_a:1", "decider:system:1"]],
  ] as const)("keeps the %s sequence and explicit side-pick turns", (format, expected) => {
    expect(getVetoTurnDefinitions(format).map((step) => `${step.actionType}:${step.actor}:${step.count}`)).toEqual(expected);
  });

  it("starts with higher seed selecting VETO A and records no side for the BO5 knife map", () => {
    const roleTurn = deriveCurrentVetoTurn({
      format: "bo5",
      entryAId: "entry-a",
      entryBId: "entry-b",
      privilegedEntryId: "entry-b",
      vetoTeamAEntryId: null,
      mapPool: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"],
      steps: [],
    });
    expect(roleTurn).toMatchObject({ actionType: "role_select", actorEntryId: "entry-b" });

    const plan = projectVetoMapPlan({
      entryAId: "entry-a",
      format: "bo5",
      steps: [
        { turnKey: "pick-veto-a-map-1", actionType: "pick", mapName: "m1", entryId: "entry-b", side: null },
        { turnKey: "side-pick-map-1", actionType: "side_pick", mapName: "m1", entryId: "entry-a", side: "ct" },
        { turnKey: "pick-veto-b-map-2", actionType: "pick", mapName: "m2", entryId: "entry-a", side: null },
        { turnKey: "side-pick-map-2", actionType: "side_pick", mapName: "m2", entryId: "entry-b", side: "t" },
        { turnKey: "pick-veto-a-map-3", actionType: "pick", mapName: "m3", entryId: "entry-b", side: null },
        { turnKey: "side-pick-map-3", actionType: "side_pick", mapName: "m3", entryId: "entry-a", side: "ct" },
        { turnKey: "pick-veto-b-map-4", actionType: "pick", mapName: "m4", entryId: "entry-a", side: null },
        { turnKey: "side-pick-map-4", actionType: "side_pick", mapName: "m4", entryId: "entry-b", side: "t" },
        { turnKey: "system-decider", actionType: "decider", mapName: "m5", entryId: null, side: null },
      ],
    });
    expect(plan[0]?.teamAStartSide).toBe("ct");
    expect(plan[4]).toMatchObject({ mapName: "m5", teamAStartSide: null });
  });

  it.each([
    ["bo1", 60],
    ["bo3", 45],
    ["bo5", 45],
  ] as const)("uses the canonical opening BAN duration for %s", (format, expectedDuration) => {
    const turn = deriveCurrentVetoTurn({
      format,
      entryAId: "entry-a",
      entryBId: "entry-b",
      privilegedEntryId: "entry-a",
      vetoTeamAEntryId: "entry-b",
      mapPool: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"],
      steps: [],
    });
    expect(turn).toMatchObject({ actionType: "ban", key: "ban-veto-a-opening", durationSeconds: expectedDuration });
  });
});
