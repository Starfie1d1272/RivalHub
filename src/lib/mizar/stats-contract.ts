/** Broadcast-only, bounded statistics. Values use the website’s current competition statistics at generation time.
 * Seven-dimensional scores use that same player scope with an independently
 * identified all-time benchmark, not an all-time player sample. */
export interface BroadcastStatsBundle {
  schemaVersion: "rivalhub.broadcast-stats.v1";
  revision: string;
  generatedAt: string;
  matchId: string;
  competitionId: string;
  scope: {
    kind: "competition";
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
  /** All three blocks share the bundle scope; coverage counts this team’s
   * completed and confirmed detailed maps. Rates carry their own denominators. */
  pistol: BroadcastTeamRateBlock & { pistol: BroadcastWinRate | null; conversion: BroadcastWinRate | null; break: BroadcastWinRate | null };
  economy: BroadcastTeamRateBlock & { ecoSemiUpset: BroadcastWinRate | null };
  utility: BroadcastTeamRateBlock & { utilityDamagePerRound: BroadcastQuantityRate | null; flashAssistsPerRound: BroadcastQuantityRate | null; enemyBlindSecondsPerFlash: BroadcastQuantityRate | null; enemyBlindSecondsPerRound: BroadcastQuantityRate | null };
  recentResults: {
    available: boolean;
    granularity: "map";
    results: Array<{ matchId: string; mapName: string; completedAt: string; opponent: { entryId: string; name: string; logoUrl: string | null }; score: number; opponentScore: number }>;
  };
  /** Per-player availability reflects only that player’s Rating and ADR coverage. */
  playerPerformance: {
    available: boolean;
    players: Array<{
      userId: string;
      available: boolean;
      /** maps/rounds cover scoreboard rows; ratingMaps counts known Rating values;
       * adrRounds counts rounds with known ADR, the weighted denominator. */
      sample: { maps: number; rounds: number | null; ratingMaps: number; adrRounds: number | null };
      rating: number | null;
      adr: number | null;
      /** All seven unique values must be finite and qualified. */
      attributes: {
        available: boolean;
        benchmark: "rivalhub-all-time-qualified";
        scope: "competition";
        sample: { rounds: number };
        values: Array<{ key: "firepower" | "entrying" | "trading" | "opening" | "clutching" | "sniping" | "utility"; score: number | null; status: "qualified" | "limited" | "no-data" }>;
      };
    }>;
  };
}

export interface BroadcastTeamRateBlock {
  available: boolean;
  scope: "competition";
  coverage: { completedMaps: number; detailedMaps: number };
}
/** Win rates use 0..1; opportunities are the denominator. */
export interface BroadcastWinRate { wins: number; opportunities: number; rate: number | null }
/** Unformatted canonical per-round/per-event rate. */
export interface BroadcastQuantityRate { successes: number; attempts: number; rate: number | null }
