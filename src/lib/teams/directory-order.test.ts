import { describe, expect, it } from "vitest";
import { sortTeamDirectory } from "./directory-order";

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
});
