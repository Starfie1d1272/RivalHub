import { describe, expect, it } from "vitest";
import { planEarlySeriesFinish, type SeriesCorrectionMapFact } from "./series-correction-rules";
const end = new Date("2026-10-01T12:30:00Z");
const map = (order: number, a: number | null, b: number | null): SeriesCorrectionMapFact => ({ id: String(order), mapOrder: order, mapName: `map-${order}`, scoreA: a, scoreB: b, completedAt: a === null ? null : end });
describe("early series finish", () => {
  it.each([true, false])("clinches BO3 symmetrically (A winner: %s)", a => {
    const maps = [map(1, a ? 13 : 9, a ? 9 : 13), map(2, a ? 9 : 13, a ? 13 : 9), map(3, null, null)];
    const plan = planEarlySeriesFinish("bo3", maps, { mapId: "2", scoreA: a ? 13 : 9, scoreB: a ? 9 : 13 });
    expect(plan).toMatchObject({ currentA: 1, currentB: 1, scoreA: a ? 2 : 0, scoreB: a ? 0 : 2, clinchingOrder: 2, completedAt: end, blockers: [] });
  });
  it("routes non-clinching edits to ordinary correction", () => {
    expect(planEarlySeriesFinish("bo3", [map(1, 13, 9), map(2, 9, 13)], { mapId: "2", scoreA: 10, scoreB: 13 })).toBeNull();
  });
  it("never hides a result after the new clincher", () => {
    expect(planEarlySeriesFinish("bo3", [map(1, 13, 9), map(2, 9, 13), map(3, 9, 13)], { mapId: "2", scoreA: 13, scoreB: 9 })?.blockers).toEqual(["Map 3 已有正式结果，请先处理实际比赛事实。"]);
  });
  it("supports a BO5 correction of an earlier map, using the new clincher's end", () => {
    expect(planEarlySeriesFinish("bo5", [map(1, 13, 9), map(2, 9, 13), map(3, 13, 9), map(4, null, null), map(5, null, null)], { mapId: "2", scoreA: 13, scoreB: 9 })).toMatchObject({ scoreA: 3, scoreB: 0, clinchingOrder: 3 });
  });
  it("rejects incomplete, noncontiguous and illegal map facts", () => {
    expect(() => planEarlySeriesFinish("bo3", [map(1, 13, 9), map(3, 9, 13)], { mapId: "3", scoreA: 13, scoreB: 9 })).toThrow("顺序");
    expect(() => planEarlySeriesFinish("bo3", [map(1, 13, null)], { mapId: "1", scoreA: 13, scoreB: 9 })).toThrow();
    expect(() => planEarlySeriesFinish("bo3", [map(1, 13, 9)], { mapId: "1", scoreA: 14, scoreB: 13 })).toThrow();
  });
});
