/** Broadcast-only, bounded statistics. Values are scoped to completed formal
 * competition matches before cutoffAt; the current match is always excluded.
 * Seven-dimensional scores use that same player scope with an independently
 * identified all-time benchmark, not an all-time player sample. */
export interface BroadcastStatsBundle {
  schemaVersion: "rivalhub.broadcast-stats.v1";
  revision: string;
  generatedAt: string;
  matchId: string;
  competitionId: string;
  scope: {
    kind: "competition-before-match";
    cutoffAt: string;
    cutoffSource: "startedAt" | "scheduledAt" | "generatedAt";
  };
  entrants: BroadcastStatsEntrant[];
}

export interface BroadcastStatsEntrant {
  entryId: string;
  name: string;
  logoUrl: string | null;
  starters: Array<{ userId: string; nickname: string; avatarUrl: string | null }>;
  /** winRate is a fraction from 0 to 1; played is the map denominator. */
  mapPerformance: {
    available: boolean;
    maps: Array<{ mapName: string; played: number; wins: number; winRate: number | null }>;
  };
  recentResults: {
    available: boolean;
    granularity: "map";
    results: Array<{ matchId: string; mapName: string; completedAt: string; opponent: { entryId: string; name: string; logoUrl: string | null }; score: number; opponentScore: number }>;
  };
  /** Available only when both five-player starting lineups have finite Rating
   * and ADR covering all scoreboard maps and rounds. */
  playerPerformance: {
    available: boolean;
    players: Array<{
      userId: string;
      /** maps/rounds cover scoreboard rows; ratingMaps counts known Rating values;
       * adrRounds counts rounds with known ADR, the weighted denominator. */
      sample: { maps: number; rounds: number | null; ratingMaps: number; adrRounds: number | null };
      rating: number | null;
      adr: number | null;
      /** All seven unique values must be finite and qualified. */
      attributes: {
        available: boolean;
        benchmark: "rivalhub-all-time-qualified";
        scope: "competition-before-match";
        sample: { rounds: number };
        values: Array<{ key: "firepower" | "entrying" | "trading" | "opening" | "clutching" | "sniping" | "utility"; score: number | null; status: "qualified" | "limited" | "no-data" }>;
      };
    }>;
  };
}
