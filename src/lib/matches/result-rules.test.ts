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
      expect(validateSeriesScore("bo1", 0, 1)).toEqual({ scoreA: 0, scoreB: 1 });
    });

    it("rejects BO1 round scores because series scores are map wins", () => {
      expect(() => validateSeriesScore("bo1", 13, 8)).toThrow("BO1 系列赛比分不合法");
      expect(() => validateSeriesScore("bo1", 7, 3)).toThrow("BO1 系列赛比分不合法");
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
      expect(validateMapScore(13, 8)).toEqual({ winner: 13, loser: 8 });
      expect(() => validateMapScore(12, 10)).toThrow("单图比分不合法");
      expect(() => validateMapScore(7, 3)).toThrow("单图比分不合法");
      expect(() => validateMapScore(13, 13)).toThrow("单图不能平局");
      expect(() => validateMapScore(13, -1)).toThrow("比分必须为非负整数");
    });
  });

  describe("computeSeriesScoreAfterMap", () => {
    it("turns a BO1 map result into a 1:0 series result", () => {
      expect(computeSeriesScoreAfterMap("bo1", [], 13, 8)).toEqual({
        mapWinsA: 1,
        mapWinsB: 0,
        seriesFinished: true,
      });
    });

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

    it("derives a BO5 series score from played map winners", () => {
      expect(
        computeSeriesScoreAfterMap("bo5", [
          { scoreA: 13, scoreB: 8 },
          { scoreA: 10, scoreB: 13 },
          { scoreA: 13, scoreB: 7 },
          { scoreA: 8, scoreB: 13 },
        ], 13, 10),
      ).toEqual({ mapWinsA: 3, mapWinsB: 2, seriesFinished: true });
    });
  });
});
