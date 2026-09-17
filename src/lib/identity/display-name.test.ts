import { describe, expect, it } from "vitest";
import { getDisplayName, getPublicDisplayName } from "./display-name";

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
