import { describe, expect, it } from "vitest";
import { coinFaces } from "@/components/predictions/coin-assets";

describe("owner coin artwork", () => {
  it.each([["青铜", "bronze"], ["白银", "silver"], ["黄金", "gold"], ["钻石", "diamond"]])("selects %s artwork", (coin, grade) => {
    expect(coinFaces(coin)).toEqual({ front: `/images/pickem/coin-${grade}.webp`, back: `/images/pickem/coin-${grade}.webp` });
  });
  it("uses bronze artwork for the separately dimmed locked state", () => {
    expect(coinFaces("未获得")).toEqual(coinFaces("青铜"));
  });
});
