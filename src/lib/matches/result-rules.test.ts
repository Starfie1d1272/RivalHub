import { describe, expect, it } from "vitest";
import {
  computeSeriesScoreAfterMap,
  validateMapScore,
  validateSeriesScore,
} from "@/lib/matches/result-rules";

describe("match result rules", () => {
  describe("validateSeriesScore", () => {
    it("accepts a BO1 decisive score", () => {
      expect(validateSeriesScore("bo1", 1, 0)).toEqual({ scoreA: 1, scoreB: 0 });
    });

    it("rejects draws and negative scores", () => {
      expect(() => validateSeriesScore("bo1", 1, 1)).toThrow("系列赛不能平局");
      expect(() => validateSeriesScore("bo3", -1, 0)).toThrow("比分必须为非负整数");
    });

    it("requires the winner to reach exact BO3/BO5 win threshold", () => {
      expect(validateSeriesScore("bo3", 2, 1)).toEqual({ scoreA: 2, scoreB: 1 });
      expect(validateSeriesScore("bo5", 3, 2)).toEqual({ scoreA: 3, scoreB: 2 });
      expect(() => validateSeriesScore("bo3", 1, 0)).toThrow("BO3 系列赛比分不合法");
      expect(() => validateSeriesScore("bo5", 4, 2)).toThrow("BO5 系列赛比分不合法");
    });
  });

  describe("validateMapScore", () => {
    it("accepts standard and overtime CS2 scores", () => {
      expect(validateMapScore(13, 11)).toEqual({ winner: 13, loser: 11 });
      expect(validateMapScore(16, 14)).toEqual({ winner: 16, loser: 14 });
      expect(validateMapScore(19, 17)).toEqual({ winner: 19, loser: 17 });
    });

    it("rejects invalid map scores", () => {
      expect(() => validateMapScore(12, 10)).toThrow("单图比分不合法");
      expect(() => validateMapScore(13, 13)).toThrow("单图不能平局");
      expect(() => validateMapScore(13, -1)).toThrow("比分必须为非负整数");
    });
  });

  describe("computeSeriesScoreAfterMap", () => {
    it("adds the new map score and reports whether the series is finished", () => {
      expect(
        computeSeriesScoreAfterMap("bo3", [
          { scoreA: 13, scoreB: 8 },
        ], 11, 13),
      ).toEqual({ mapWinsA: 1, mapWinsB: 1, seriesFinished: false });

      expect(
        computeSeriesScoreAfterMap("bo3", [
          { scoreA: 13, scoreB: 8 },
        ], 13, 11),
      ).toEqual({ mapWinsA: 2, mapWinsB: 0, seriesFinished: true });
    });

    it("ignores unscored existing maps", () => {
      expect(
        computeSeriesScoreAfterMap("bo5", [
          { scoreA: 13, scoreB: 9 },
          { scoreA: null, scoreB: null },
        ], 13, 10),
      ).toEqual({ mapWinsA: 2, mapWinsB: 0, seriesFinished: false });
    });
  });
});
