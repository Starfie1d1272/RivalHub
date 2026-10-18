import type { LiveSnapshotV1 } from "./protocol";

export const LINEUP_REVIEW_REQUIRED = "review_required";

/** A producer must distinguish a roster difference from every other identity failure. */
export function isLineupMismatchOnly(evidence: { identity: string; lineupMismatchOnly?: boolean }): boolean {
  return (evidence.identity === "degraded" || evidence.identity === "matched") && evidence.lineupMismatchOnly === true;
}

/** Only current, unique human accounts with proven CT/T teams can use the exception. */
export function hasObservedLineup(snapshot: Pick<LiveSnapshotV1, "capability" | "players">): boolean {
  return isLineupMismatchOnly(snapshot.capability) && snapshot.capability.lineupComplete && snapshot.capability.canonicalTeams
    && hasCurrentLineup(snapshot.players);
}

export function hasCurrentLineup(players: LiveSnapshotV1["players"]): boolean {
  return players.length === 10 && new Set(players.map(player => player.sourcePlayerId)).size === 10
    && players.every(player => /^\d{17}$/.test(player.sourcePlayerId) && player.lineupEvidence === "current")
    && players.filter(player => player.side === "CT").length === 5
    && players.filter(player => player.side === "T").length === 5;
}
