/** A compact score breakdown derived only from a complete sequence of round facts. */
export type RoundSegment = { scoreA: number; scoreB: number; sideA: "ct" | "t" };
export type RoundSegments = {
  firstHalf: RoundSegment;
  secondHalf: RoundSegment;
  overtime: { scoreA: number; scoreB: number } | null;
};

type Round = {
  roundSeq: number;
  phase: "regulation" | "overtime";
  teamASide: "ct" | "t";
  teamBSide: "ct" | "t";
  teamAScoreBefore: number;
  teamBScoreBefore: number;
  winnerTeamKey: string;
};

export function getRoundSegments(
  rounds: readonly Round[],
  scoreA: number,
  scoreB: number,
): RoundSegments | null {
  const ordered = [...rounds].sort((a, b) => a.roundSeq - b.roundSeq);
  if (!ordered.length) return null;
  const firstSide = ordered[0].teamASide;
  const firstHalf: RoundSegment = { scoreA: 0, scoreB: 0, sideA: firstSide };
  const secondHalf: RoundSegment = { scoreA: 0, scoreB: 0, sideA: firstSide === "ct" ? "t" : "ct" };
  const overtime = { scoreA: 0, scoreB: 0 };
  let a = 0,
    b = 0,
    switched = false,
    inOvertime = false;
  for (const [index, round] of ordered.entries()) {
    if (
      round.roundSeq !== index + 1 ||
      round.teamAScoreBefore !== a ||
      round.teamBScoreBefore !== b ||
      round.teamASide === round.teamBSide
    )
      return null;
    if (round.phase === "overtime") inOvertime = true;
    else if (inOvertime) return null;
    if (!inOvertime && round.teamASide !== firstSide) switched = true;
    if (!inOvertime && switched && round.teamASide === firstSide) return null;
    const segment = inOvertime ? overtime : switched ? secondHalf : firstHalf;
    if (round.winnerTeamKey === "teamA") {
      segment.scoreA++;
      a++;
    } else if (round.winnerTeamKey === "teamB") {
      segment.scoreB++;
      b++;
    } else return null;
  }
  if (!switched || a !== scoreA || b !== scoreB) return null;
  return { firstHalf, secondHalf, overtime: inOvertime ? overtime : null };
}
