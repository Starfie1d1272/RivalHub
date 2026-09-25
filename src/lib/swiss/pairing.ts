import type { SwissPair, SwissTeamState } from "./types";

function validateUniqueTeams(teams: readonly SwissTeamState[]): void {
  const teamIds = new Set<string>();
  for (const team of teams) {
    if (!team.teamId) throw new Error("Swiss pairing team id must be non-empty");
    if (teamIds.has(team.teamId)) throw new Error(`duplicate Swiss pairing team: ${team.teamId}`);
    teamIds.add(team.teamId);
  }
}

function toPair(higher: SwissTeamState, lower: SwissTeamState): SwissPair {
  return {
    higherSeedTeamId: higher.teamId,
    lowerSeedTeamId: lower.teamId,
    higherSeed: higher.currentSeed,
    lowerSeed: lower.currentSeed,
  };
}

/** Initial Swiss pairing: top half versus bottom half at the same position. */
export function pairSwissTopHalfBottomHalf(teams: readonly SwissTeamState[]): readonly SwissPair[] {
  validateUniqueTeams(teams);
  if (teams.length < 2 || teams.length % 2 !== 0) {
    throw new Error("initial Swiss pairing requires a positive even team count");
  }
  const ranked = [...teams].sort((a, b) => a.currentSeed - b.currentSeed);
  const half = ranked.length / 2;
  return Array.from({ length: half }, (_, index) => toPair(ranked[index]!, ranked[index + half]!));
}

/** True when the remaining teams have a complete matching without rematches. */
export function hasCompleteZeroRematchMatching(teams: readonly SwissTeamState[]): boolean {
  if (teams.length === 0) return true;
  if (teams.length % 2 !== 0) return false;
  const ranked = [...teams].sort((a, b) => a.currentSeed - b.currentSeed);
  const higher = ranked[0]!;
  for (let index = ranked.length - 1; index >= 1; index -= 1) {
    const lower = ranked[index]!;
    if (lower.opponents.includes(higher.teamId)) continue;
    const rest = ranked.filter((_, candidate) => candidate !== 0 && candidate !== index);
    if (hasCompleteZeroRematchMatching(rest)) return true;
  }
  return false;
}

/** Exact-record, feasibility-aware high-low pairing with no cross-record fallback. */
export function pairSwissHighLowZeroRematch(teams: readonly SwissTeamState[]): readonly SwissPair[] {
  validateUniqueTeams(teams);
  if (teams.length < 2 || teams.length % 2 !== 0) {
    throw new Error("Swiss high-low pairing requires a positive even team count");
  }
  const first = teams[0]!;
  if (teams.some((team) => team.wins !== first.wins || team.losses !== first.losses)) {
    throw new Error("Swiss high-low pairing requires one exact-record group");
  }

  const available = [...teams].sort((a, b) => a.currentSeed - b.currentSeed);
  const pairs: SwissPair[] = [];
  while (available.length > 0) {
    const higher = available.shift()!;
    let lowerIndex = -1;
    for (let index = available.length - 1; index >= 0; index -= 1) {
      if (available[index]!.opponents.includes(higher.teamId)) continue;
      const rest = available.filter((_, candidate) => candidate !== index);
      if (hasCompleteZeroRematchMatching(rest)) {
        lowerIndex = index;
        break;
      }
    }
    if (lowerIndex < 0) {
      throw new Error(`no complete zero-rematch pairing exists for the ${first.wins}-${first.losses} group`);
    }
    pairs.push(toPair(higher, available.splice(lowerIndex, 1)[0]!));
  }
  return pairs;
}

export function groupSwissByRecord(teams: readonly SwissTeamState[]): readonly {
  record: { wins: number; losses: number };
  teams: readonly SwissTeamState[];
}[] {
  const groups = new Map<string, SwissTeamState[]>();
  for (const team of teams) {
    const key = `${team.wins}-${team.losses}`;
    const group = groups.get(key) ?? [];
    group.push(team);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const [leftWins, leftLosses] = left.split("-").map(Number);
      const [rightWins, rightLosses] = right.split("-").map(Number);
      return rightWins! - leftWins! || leftLosses! - rightLosses!;
    })
    .map(([key, groupedTeams]) => {
      const [wins, losses] = key.split("-").map(Number);
      return { record: { wins: wins!, losses: losses! }, teams: [...groupedTeams].sort((a, b) => a.currentSeed - b.currentSeed) };
    });
}
