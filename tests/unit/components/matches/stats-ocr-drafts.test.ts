import { describe, expect, it } from "vitest";
import { assignScreenshotPlayer, mergeScreenshotDrafts, type ScoreboardDraft } from "@/components/matches/stats-ocr-drafts";

const demo: ScoreboardDraft = { userId: "u1", perfectName: "队伍前缀  选手", gameplayLocked: true, kills: 22, deaths: 7, assists: 3, adr: 90, hsPercent: 50, firstKills: 1, multiKills: 2, clutches: 0, ratingPro: null, rws: null, we: null };
const screenshot = { ...demo, gameplayLocked: undefined, userId: null, perfectName: "选手", kills: 999, adr: 999, ratingPro: 1.5, rws: 12, we: 8 };

describe("screenshot and Demo draft identity join", () => {
  it("requires an explicit identity for a different nickname and consumes only the selected screenshot", () => {
    const drafts = mergeScreenshotDrafts([screenshot], [demo]);
    expect(drafts).toHaveLength(2);
    const merged = assignScreenshotPlayer(drafts, 0, { userId: "u1", perfectName: "当前登记名" });
    expect(merged).toEqual([{ ...demo, ratingPro: 1.5, rws: 12, we: 8 }]);
  });

  it("does not infer identity even when an unresolved name equals the Demo snapshot", () => {
    expect(mergeScreenshotDrafts([{ ...screenshot, perfectName: demo.perfectName }], [demo])).toHaveLength(2);
  });

  it("keeps OCR-first rows editable, joins a later Demo by identity, and repeats enrichment without duplicates", () => {
    const first = { ...screenshot, userId: "u1" };
    expect(mergeScreenshotDrafts([first], [])).toEqual([first]);
    const afterDemo = mergeScreenshotDrafts([first], [demo]);
    const repeated = mergeScreenshotDrafts([{ ...first, ratingPro: 1.6, rws: null }], afterDemo);
    expect(repeated).toEqual([{ ...demo, ratingPro: 1.6, rws: 12, we: 8 }]);
  });

  it("does not silently merge already assigned rows or another OCR player's identity", () => {
    const rows = [screenshot, { ...demo, gameplayLocked: false }];
    expect(assignScreenshotPlayer(rows, 0, { userId: "u1", perfectName: "选手" })).toBe(rows);
    const assigned = [{ ...screenshot, userId: "u2" }, demo];
    expect(assignScreenshotPlayer(assigned, 0, { userId: "u1", perfectName: "选手" })).toBe(assigned);
  });
});
