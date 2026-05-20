import { AppError, ErrorCode } from "@/lib/errors";
import { getWinThreshold, type MatchFormat } from "@/types/match";

export function isValidCS2RoundScore(winner: number, loser: number): boolean {
  return winner >= 13 && (winner - 13) % 3 === 0 && loser >= 0 && loser < winner;
}

export function validateSeriesScore(
  format: MatchFormat,
  scoreA: number,
  scoreB: number,
): { scoreA: number; scoreB: number } {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "比分必须为非负整数");
  }
  if (scoreA === scoreB) {
    throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "系列赛不能平局，必须分出胜负");
  }

  const maxWins = format === "bo1" ? null : getWinThreshold(format);
  if (maxWins !== null) {
    const winner = Math.max(scoreA, scoreB);
    const loser = Math.min(scoreA, scoreB);
    if (winner !== maxWins || loser >= maxWins) {
      throw new AppError(
        ErrorCode.MATCH_INVALID_SCORE,
        `${format.toUpperCase()} 系列赛比分不合法（胜者须恰好赢 ${maxWins} 图）`,
      );
    }
  }

  return { scoreA, scoreB };
}

export function validateMapScore(scoreA: number, scoreB: number): { winner: number; loser: number } {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "比分必须为非负整数");
  }
  if (scoreA === scoreB) {
    throw new AppError(ErrorCode.MATCH_INVALID_SCORE, "单图不能平局");
  }

  const winner = Math.max(scoreA, scoreB);
  const loser = Math.min(scoreA, scoreB);
  if (!isValidCS2RoundScore(winner, loser)) {
    throw new AppError(
      ErrorCode.MATCH_INVALID_SCORE,
      "单图比分不合法，胜者回合数须满足 13 + 3k（如 13、16、19、22…）",
    );
  }

  return { winner, loser };
}

export function computeSeriesScoreAfterMap(
  format: MatchFormat,
  existingMaps: { scoreA: number | null; scoreB: number | null }[],
  scoreA: number,
  scoreB: number,
): { mapWinsA: number; mapWinsB: number; seriesFinished: boolean } {
  const maxWins = getWinThreshold(format);
  const scoredMaps = existingMaps.filter((m) => m.scoreA !== null);
  const allMaps = [...scoredMaps, { scoreA, scoreB }];
  let mapWinsA = 0;
  let mapWinsB = 0;

  for (const m of allMaps) {
    if (m.scoreA === null || m.scoreB === null) continue;
    if (m.scoreA > m.scoreB) mapWinsA++;
    else mapWinsB++;
  }

  return {
    mapWinsA,
    mapWinsB,
    seriesFinished: mapWinsA >= maxWins || mapWinsB >= maxWins,
  };
}
