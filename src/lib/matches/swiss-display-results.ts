import type { SwissStageReadModel } from "./stage-read-model";

type DisplayEntry = Pick<SwissStageReadModel["competitionEntries"][number],
  "entryId" | "teamName" | "logoUrl" | "wins" | "losses">;

/** Result cards may show settled matches before the whole round is finalized.
 * This does not update the canonical standings, seeds, or round progression.
 */
export function getSwissResultDisplayEntries(data: SwissStageReadModel): DisplayEntry[] {
  const entries = new Map(data.competitionEntries.map(entry => [entry.entryId, {
    entryId: entry.entryId, teamName: entry.teamName, logoUrl: entry.logoUrl,
    wins: entry.wins, losses: entry.losses,
  }]));
  const activeIds = new Set(data.competitionEntries.filter(entry => entry.status === "active").map(entry => entry.entryId));
  const currentRound = data.rounds.find(round => round.round === data.finalizedRound + 1 && round.status === "active");
  const matches = currentRound?.groups.flatMap(group => group.matchups) ?? [];
  const appearances = new Map<string, number>();
  for (const match of matches) {
    for (const id of [match.entryAId, match.entryBId]) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  }
  for (const match of matches) {
    const { scoreA, scoreB } = match;
    if (match.status !== "finished" || scoreA === null || scoreB === null ||
      !Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB ||
      match.round !== currentRound?.round || appearances.get(match.entryAId) !== 1 || appearances.get(match.entryBId) !== 1 ||
      !activeIds.has(match.entryAId) || !activeIds.has(match.entryBId)) continue;
    const a = entries.get(match.entryAId);
    const b = entries.get(match.entryBId);
    if (!a || !b) continue;
    const [winner, loser] = scoreA > scoreB ? [a, b] : [b, a];
    winner.wins += 1;
    loser.losses += 1;
  }
  return [...entries.values()];
}
