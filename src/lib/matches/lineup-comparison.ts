import type { RosterPlayer } from "./detail-stats";

export interface LineupCareer {
  userId: string;
  maps: number;
  rounds: number | null;
  qualified: boolean;
  rating: number | null;
  adr: number | null;
  kpr: number | null;
  kast: number | null;
  firstKill: number | null;
  trade: number | null;
}

export interface LineupPlayer extends RosterPlayer {
  substituteAppearance?: boolean;
}

export function lineupComparisonCutoff(match: { startedAt: Date | null; gameplayStartedAt: Date | null; scheduledAt: Date | null }, now = new Date()) {
  return match.startedAt ?? match.gameplayStartedAt
    ?? (match.scheduledAt && match.scheduledAt <= now ? match.scheduledAt : null);
}

/** Prefer eligible Rating; a sparse roster falls back to experience, never a fake star. */
export function defaultLineupPlayer(players: readonly LineupPlayer[], careers: readonly LineupCareer[]) {
  const byUser = new Map(careers.map((career) => [career.userId, career]));
  const starters = players.filter((player) => player.isStarter);
  const qualified = starters.filter((player) => {
    const career = player.userId ? byUser.get(player.userId) : undefined;
    return career?.qualified && career.rating !== null;
  });
  return [...(qualified.length ? qualified : starters)].sort((a, b) => {
    const left = a.userId ? byUser.get(a.userId) : undefined;
    const right = b.userId ? byUser.get(b.userId) : undefined;
    return (qualified.length ? (right?.rating ?? 0) - (left?.rating ?? 0) : 0)
      || (right?.maps ?? 0) - (left?.maps ?? 0)
      || (a.userId ?? "").localeCompare(b.userId ?? "");
  })[0]?.userId ?? null;
}

/** Missing saved lineups are only previewed before the match starts. */
export function resolveLineup(
  submitted: RosterPlayer[] | null,
  registered: (RosterPlayer & { isPrimaryStarter: boolean })[],
  allowExpected: boolean,
): { players: LineupPlayer[] | null; expected: boolean } {
  if (submitted) {
    const primary = new Map(registered.map((player) => [player.userId, player.isPrimaryStarter]));
    return { players: submitted.map((player) => ({ ...player, substituteAppearance: player.isStarter && primary.get(player.userId) === false })), expected: false };
  }
  return allowExpected
    ? { players: registered.filter((player) => player.isPrimaryStarter).map((player) => ({ ...player, isStarter: true })), expected: true }
    : { players: null, expected: false };
}
