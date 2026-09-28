import { describe, expect, it } from "vitest";
import { presentLiveBomb } from "./live-presentation";

const players = [{ sourcePlayerId: "p1", displayName: "选手一" }] as never;

describe("LIVE bomb presentation", () => {
  it("presents active actions, carrier identity and terminal states", () => {
    expect(presentLiveBomb({ state: "planting", carrierSourceId: "p1", action: { kind: "plant", sourcePlayerId: "p1", remainingSeconds: 2.2, durationSeconds: 3 } }, players)).toBe("正在安放 C4 · 选手一 · 3 秒");
    expect(presentLiveBomb({ state: "carried", carrierSourceId: "p1", action: null }, players)).toBe("C4 携带者：选手一");
    expect(presentLiveBomb({ state: "defused", carrierSourceId: null, action: null }, players)).toBe("C4 已拆除");
  });

  it("keeps unknown or missing states from leaking raw values", () => {
    expect(presentLiveBomb({ state: "producer-private-state", carrierSourceId: null, action: null }, players)).toBe("C4 状态暂不可用");
    expect(presentLiveBomb(null, players)).toBe("C4 状态暂不可用");
  });
});
