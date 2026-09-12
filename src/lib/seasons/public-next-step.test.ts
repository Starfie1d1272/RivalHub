import { describe, expect, it } from "vitest";
import { presentUpcomingMatchTask } from "./public-next-step";

describe("public season personal next step", () => {
  it("presents an explicitly started match as the current task", () => {
    expect(presentUpcomingMatchTask({
      matchId: "match-1", seasonSlug: "autumn-2026", opponentName: "对手队",
      scheduledAt: null, status: "in_progress",
    })).toMatchObject({ title: "你的当前比赛", detail: "对阵 对手队 · 进行中" });
  });
  it("links a confirmed participant to a scheduled match without implying LIVE state", () => {
    expect(presentUpcomingMatchTask({
      matchId: "match-1",
      seasonSlug: "autumn-2026",
      opponentName: "对手队",
      scheduledAt: new Date("2026-09-12T12:00:00.000Z"),
    })).toEqual({
      title: "你的下一场",
      detail: "对阵 对手队 · 待进行",
      href: "/autumn-2026/matches/match-1",
    });
  });
});
