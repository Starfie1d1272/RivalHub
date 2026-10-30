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
  mapPool?: string[] | null;
  support?: BroadcastMatchSupport | null;
}

export interface BroadcastStatsEntrant {
  facts?: BroadcastStatsFacts | null;
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
  /** Per-player availability reflects a valid Rating sample; ADR may be null and has its own denominator. */
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

/** Optional extension: old v1 bundles without these fields remain valid. All
 * rates are raw fractions or quantities; samples use their canonical denominator. */
export interface BroadcastStatsFacts {
  source: "competition-canonical";
  coverage: { completedMaps: number; detailedMaps: number };
  results: { matches: number; matchWins: number; matchLosses: number; maps: number; mapWins: number; mapLosses: number } | null;
  maps: Array<{
    mapName: string;
    results: { played: number; wins: number; losses: number } | null;
    rounds: { wins: number; rounds: number; rate: number | null; ct: BroadcastWinRate; t: BroadcastWinRate } | null;
    selection: { picks: number; bans: number; deciders: number } | null;
    coverage: { completedMaps: number; detailedMaps: number };
  }>;
  /** Completed series, newest completedAt first (null last), then matchId descending.
   * At most 50, total counts eligible series before truncation. Maps sort by completedAt (null first), then name. */
  series: { total: number; truncated: boolean; matches: Array<{
    matchId: string; stage: string; round: number | null; completedAt: string | null;
    opponent: { entryId: string; name: string; logoUrl: string | null };
    score: number; opponentScore: number;
    maps: Array<{ mapName: string; completedAt: string | null; score: number | null; opponentScore: number | null }>;
  }> };
  teamRating: { rating: number; ratingSamples: number } | null;
  rounds: { wins: number; rounds: number; rate: number | null; ct: BroadcastWinRate; t: BroadcastWinRate } | null;
  manAdvantage: Record<"5v4" | "4v5" | "5v3" | "3v5", BroadcastWinRate> | null;
  opening: { successRate: BroadcastQuantityRate; winAfterOpening: BroadcastQuantityRate; tradeKillsPerRound: BroadcastQuantityRate; tradedOpeningDeaths: number; firstDeaths: number; openingDeathTraded: BroadcastQuantityRate; comebackRate: BroadcastQuantityRate } | null;
  utility: { sample: { rounds: number }; flashesThrown: number; utilityDamagePerRound: BroadcastQuantityRate; flashAssistsPerRound: BroadcastQuantityRate; utilityKillsPerRound: BroadcastQuantityRate; enemyBlindSecondsPerFlash: BroadcastQuantityRate; enemyBlindSecondsPerRound: BroadcastQuantityRate; teamBlindSecondsPerRound: BroadcastQuantityRate } | null;
  plantConversions: BroadcastQuantityRate | null;
  weapons: Array<{ weapon: string; kills: number; killShare: BroadcastQuantityRate; killsPerRound: BroadcastQuantityRate }> | null;
  /** Current starters only; scoreboard and detailed samples retain independent denominators. */
  players: Array<{
    userId: string; maps: number; ratingMaps: number; rounds: number | null; adrRounds: number | null;
    rating: number | null; adr: number | null; kd: number | null;
    /** Independent confirmed scoreboard samples, not Demo samples. Rates are per
     * round; kast is 0..1, avgHs is a percentage on 0..100, kd is kills/death. */
    scoreboard?: BroadcastScoreboard | null;
    detailed: { sample: { rounds: number }; kast: BroadcastQuantityRate; killsPerRound: BroadcastQuantityRate; headshotRate: BroadcastQuantityRate; twoKillRounds: number; threeKillRounds: number; fourKillRounds: number; fiveKillRounds: number; openingSuccess: BroadcastQuantityRate; tradeKillsPerRound: BroadcastQuantityRate; clutch: { attempts: number; wins: number; winRate: BroadcastQuantityRate; byOpponentCount: Record<"1" | "2" | "3" | "4" | "5", BroadcastQuantityRate> } } | null;
  }>;
}

/** Decimal strings preserve arbitrary precision; ratios are truncated to 9 decimal places and null for zero total. A mismatched market has no support block. */
export interface BroadcastMatchSupport {
  total: string;
  sides: Array<{ entryId: string; amount: string; ratio: number | null }>;
}

/** Each sample is the actual denominator of that canonical scoreboard value;
 * null means no matching source rows, 0 means a known zero denominator. */
export interface BroadcastScoreboard {
  source: "confirmed-scoreboard";
  kpr: { value: number | null; rounds: number | null };
  fkpr: { value: number | null; rounds: number | null };
  mkpr: { value: number | null; rounds: number | null };
  cpr: { value: number | null; rounds: number | null };
  fdpr: { value: number | null; rounds: number | null };
  tradeKpr: { value: number | null; rounds: number | null };
  kast: { value: number | null; rounds: number | null };
  avgHs: { value: number | null; kills: number | null };
  kd: { value: number | null; deaths: number | null };
}
