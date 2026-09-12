import { describe, expect, it } from "vitest";
import { presentUpcomingMatchTask } from "./public-next-step";

describe("public season personal next step", () => {
  it("links a confirmed participant to a scheduled match without implying LIVE state", () => {
    expect(presentUpcomingMatchTask({
      matchId: "match-1",
      seasonSlug: "autumn-2026",
      opponentName: "对手队",
      scheduledAt: new Date("2026-09-12T12:00:00.000Z"),
    })).toEqual({
      title: "你的下一场",
      detail: "对阵 对手队 · 赛程已安排",
      href: "/autumn-2026/matches/match-1",
    });
  });
});
