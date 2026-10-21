import { describe, expect, it } from "vitest";
import { coinFaces, COIN_FINISHES } from "@/components/predictions/coin-assets";

describe("owner coin artwork", () => {
  it.each([["青铜", "bronze"], ["白银", "silver"], ["黄金", "gold"], ["钻石", "diamond"]])("selects %s artwork", (coin, grade) => {
    expect(coinFaces(coin)).toEqual({ front: `/images/pickem/coin-${grade}.webp`, back: `/images/pickem/coin-${grade}.webp` });
  });
  it("uses bronze artwork for the unearned state", () => {
    expect(coinFaces("未获得")).toEqual(coinFaces("青铜"));
    expect(COIN_FINISHES.未获得!.metal).toBe(COIN_FINISHES.青铜!.metal);
  });
});
