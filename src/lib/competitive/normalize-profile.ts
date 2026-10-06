import { AppError, ErrorCode } from "@/lib/errors";

export type RankedPeak = { status: "ranked"; rank: string; stars: number | null; rating: number };
export type SeasonPeak = ({ seasonKey: string } & RankedPeak) | { seasonKey: string; status: "unranked"; rating: number | null } | { seasonKey: string; status: "unrecorded" };
export type HistoricalPeak = RankedPeak & { achievedSeasonKey: string | null };
export type PeakLadder = readonly { rankKey: string; label: string; sortOrder: number; starMin: number | null; starMax: number | null }[];

function compare(left: RankedPeak, right: RankedPeak, ladder: PeakLadder): number {
  const ranks = new Map(ladder.map(rank => [rank.rankKey, rank.sortOrder]));
  return (ranks.get(left.rank)! - ranks.get(right.rank)!) || ((left.stars ?? 0) - (right.stars ?? 0));
}
function describe(peak: SeasonPeak | HistoricalPeak, ladder: PeakLadder): string {
  if (peak.status === "unrecorded") return "未录入";
  if (peak.status === "unranked") return "未定级";
  return `${ladder.find(rank => rank.rankKey === peak.rank)?.label ?? peak.rank}${peak.stars === null ? "" : ` ${peak.stars}★`} / Rating ${peak.rating}`;
}

/** One owner for linked peaks. Inputs include untouched persisted season facts. */
export function normalizeCompetitivePeaks(historical: HistoricalPeak, seasons: readonly SeasonPeak[], ladder: PeakLadder) {
  let historicalPeak = { ...historical };
  const seasonPeaks = seasons.map(peak => ({ ...peak }));
  const notices: string[] = [];
  if (historical.achievedSeasonKey !== null) {
    const index = seasonPeaks.findIndex(peak => peak.seasonKey === historical.achievedSeasonKey);
    const season = seasonPeaks[index];
    if (!season || season.status === "unrecorded") {
      const linked: SeasonPeak = { status: "ranked", rank: historical.rank, stars: historical.stars, rating: historical.rating, seasonKey: historical.achievedSeasonKey };
      if (index < 0) seasonPeaks.push(linked); else seasonPeaks[index] = linked;
      notices.push(`已同步到 ${historical.achievedSeasonKey}`);
    } else if (season.status !== "ranked" || season.rank !== historical.rank || season.stars !== historical.stars || season.rating !== historical.rating) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `历史最高填写为「${describe(historical, ladder)}，达成于 ${historical.achievedSeasonKey}」，但 ${historical.achievedSeasonKey} 记录为「${describe(season, ladder)}」。请确认哪一条正确，并在一次保存中修正两个值。`);
    }
  }
  // Stable input order (catalog order at the server) freezes equal-peak selection.
  for (const season of seasonPeaks) {
    if (season.status === "ranked" && compare(season, historicalPeak, ladder) > 0) {
      historicalPeak = { status: "ranked", rank: season.rank, stars: season.stars, rating: season.rating, achievedSeasonKey: season.seasonKey };
    }
  }
  if (compare(historicalPeak, historical, ladder) > 0) notices.push(`${historicalPeak.achievedSeasonKey} 已超过原历史最高，已同步更新历史最高`);
  return { historicalPeak, seasonPeaks, notices };
}
