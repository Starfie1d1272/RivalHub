"use server";

// TODO: create a match between two teams in a season
export async function createMatch(
  _seasonId: string,
  _teamAId: string,
  _teamBId: string
): Promise<string> {
  throw new Error("not implemented");
}

// TODO: record match result — updates score, status, bracket node
export async function recordMatchResult(
  _matchId: string,
  _scoreA: number,
  _scoreB: number
): Promise<void> {
  throw new Error("not implemented");
}

// TODO: update bracket via brackets-manager
export async function updateBracket(_seasonId: string): Promise<void> {
  throw new Error("not implemented");
}
