import { describe, it, expect } from "vitest";
import { betRosterRestriction } from "./admission";
describe("BET roster conflict", () => {
  const roster = [{userId: "player", entryId: "a", current: true}, {userId: "former", entryId: "a", current: false}];
  it("restricts only current members of subject teams, including event subjects", () => {
    expect(betRosterRestriction("player", ["a", "b"], roster)).toMatch(/名单成员/);
    expect(betRosterRestriction("player", ["b", "c"], roster)).toBeNull();
    expect(betRosterRestriction("player", ["c", "b", "a"], roster)).not.toBeNull();
    expect(betRosterRestriction("former", ["a", "b"], roster)).toBeNull();
    expect(betRosterRestriction(null, ["a", "b"], roster)).toBeNull();
  });
});
