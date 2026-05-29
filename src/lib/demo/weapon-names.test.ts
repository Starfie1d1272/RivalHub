import { describe, it, expect } from "vitest";
import { displayWeaponName } from "./weapon-names";

describe("displayWeaponName", () => {
  it("returns known aliases", () => {
    expect(displayWeaponName("AK-47")).toBe("AK47");
    expect(displayWeaponName("M4A4")).toBe("M4A4");
    expect(displayWeaponName("M4A1-S")).toBe("M4A1");
    expect(displayWeaponName("SSG 08")).toBe("SSG 08");
    expect(displayWeaponName("Five-SeveN")).toBe("FN57");
    expect(displayWeaponName("CZ75-Auto")).toBe("CZ75");
    expect(displayWeaponName("UMP-45")).toBe("UMP45");
    expect(displayWeaponName("PP-Bizon")).toBe("野牛");
    expect(displayWeaponName("SG 553")).toBe("SG553");
    expect(displayWeaponName("XM1014")).toBe("XM1014");
  });

  it("passes through unknown weapons", () => {
    expect(displayWeaponName("M249")).toBe("M249");
    expect(displayWeaponName("Molotov")).toBe("Molotov");
    expect(displayWeaponName("Flashbang")).toBe("Flash");
  });

  it("returns raw string for unmapped weapons", () => {
    expect(displayWeaponName("SomeFutureGun")).toBe("SomeFutureGun");
  });
});
