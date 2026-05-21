import { describe, expect, it } from "vitest";
import { getSwissDirectoryOrder, sortTeamDirectory } from "./directory-order";

const teams = [
  { id: "team-a", draftOrder: 1 },
  { id: "team-b", draftOrder: 2 },
  { id: "team-c", draftOrder: 3 },
];

describe("sortTeamDirectory", () => {
  it("uses standings order during the qualifier stage", () => {
    const sorted = sortTeamDirectory(teams, {
      mode: "qualifier",
      standingsOrder: ["team-c", "team-a", "team-b"],
    });

    expect(sorted.map((team) => team.id)).toEqual(["team-c", "team-a", "team-b"]);
  });

  it("uses playoff seeds before standings in the main stage", () => {
    const sorted = sortTeamDirectory(teams, {
      mode: "playoff",
      playoffSeedOrder: ["team-b", "team-c"],
      standingsOrder: ["team-c", "team-a", "team-b"],
    });

    expect(sorted.map((team) => team.id)).toEqual(["team-b", "team-c", "team-a"]);
  });

  it("falls back to draft order when stage order data is missing", () => {
    const sorted = sortTeamDirectory([...teams].reverse(), {
      mode: "playoff",
      playoffSeedOrder: [],
      standingsOrder: [],
    });

    expect(sorted.map((team) => team.id)).toEqual(["team-a", "team-b", "team-c"]);
  });

  it("orders Swiss standings by record, BU score, and original seed", () => {
    expect(getSwissDirectoryOrder([
      { teamId: "team-a", seed: 1, wins: 2, losses: 1, buScore: 3, status: "active" },
      { teamId: "team-b", seed: 2, wins: 3, losses: 0, buScore: 1, status: "advanced" },
      { teamId: "team-c", seed: 3, wins: 2, losses: 1, buScore: 5, status: "active" },
      { teamId: "team-d", seed: 4, wins: 0, losses: 3, buScore: -2, status: "eliminated" },
    ])).toEqual(["team-b", "team-c", "team-a", "team-d"]);
  });
});
