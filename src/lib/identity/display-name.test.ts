import { describe, expect, it } from "vitest";
import { getDisplayName, getPublicDisplayName, getMatchPlayerDisplayName } from "./display-name";

describe("display names", () => {
  it("keeps private email fallback available for authenticated workflows", () => {
    expect(getDisplayName({ email: "player@example.com" })).toBe("player");
  });

  it("fails closed for public identities when no public name exists", () => {
    expect(getPublicDisplayName({ displayName: null, perfectName: null, personaName: null })).toBe("未知用户");
  });

  it("prefers public identity fields without needing private contact data", () => {
    expect(getPublicDisplayName({ displayName: "Display", perfectName: "Perfect", personaName: "Steam" })).toBe("Display");
    expect(getPublicDisplayName({ displayName: null, perfectName: "Perfect", personaName: "Steam" })).toBe("Steam");
    expect(getPublicDisplayName({ displayName: null, perfectName: null, personaName: "Steam" })).toBe("Steam");
  });
});

// Protects the presentation-only boundary against over-aggressive nickname cleanup.
describe("match scoreboard names", () => {
  it.each([
    ["Alpha | Player", "Alpha", "Player"],
    ["aLpHa Player With Spaces", "Alpha", "Player With Spaces"],
    ["[Alpha] · 同名🎮", "Alpha", "同名🎮"],
    ["【Alpha】｜小 明", "Alpha", "小 明"],
    ["AlphaPlayer", "Alpha", "AlphaPlayer"],
    ["Player Alpha | End", "Alpha", "Player Alpha | End"],
    ["A | Player", "Alpha", "A | Player"],
    ["Bravo | Player", "Alpha", "Bravo | Player"],
    ["Alpha", "Alpha", "Alpha"],
    ["Alpha | ", "Alpha", "Alpha | "],
    ["Alpha | Player", null, "Alpha | Player"],
    ["Alpha | Player", " ", "Alpha | Player"],
    ["", "Alpha", ""],
  ])("formats %s only against its proven team", (name, team, expected) => {
    expect(getMatchPlayerDisplayName(name, team)).toBe(expected);
  });
});
