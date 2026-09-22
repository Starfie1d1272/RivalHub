type MetricUnit = "number" | "percent" | "perRound" | "seconds" | "count";
type SampleKind = "scoreboard" | "kills" | "rounds" | "openings" | "deaths" | "flashes" | "attempts" | "pistolRounds" | "opportunities" | "plants" | "weaponKills" | "maps";

const sampleLabels: Record<SampleKind, string> = {
  scoreboard: "maps",
  kills: "kills",
  rounds: "rounds",
  openings: "openings",
  deaths: "deaths",
  flashes: "flashes",
  attempts: "attempts",
  pistolRounds: "pistol rounds",
  opportunities: "opportunities",
  plants: "plants",
  weaponKills: "weapon kills",
  maps: "maps",
};

function metric<K extends SampleKind>(label: string, unit: MetricUnit, precision: number, sampleKind: K) {
  return { label, unit, precision, sampleKind, sampleLabel: sampleLabels[sampleKind] };
}

export const STATS_METRICS = {
  rating: metric("Rating", "number", 2, "scoreboard"),
  adr: metric("ADR", "number", 1, "scoreboard"),
  kd: metric("K/D", "number", 2, "scoreboard"),
  kpr: metric("K/R", "perRound", 2, "scoreboard"),
  hs: metric("HS%", "percent", 1, "kills"),
  we: metric("WE", "number", 1, "scoreboard"),
  rws: metric("RWS", "number", 2, "scoreboard"),
  mk: metric("MK/R", "perRound", 2, "scoreboard"),
  openingAttempt: metric("Open Att%", "percent", 1, "rounds"),
  openingWin: metric("Open Win%", "percent", 1, "openings"),
  firstKill: metric("FK/R", "perRound", 2, "rounds"),
  firstDeath: metric("FD/R", "perRound", 2, "rounds"),
  kast: metric("KAST", "percent", 1, "rounds"),
  survival: metric("Survival%", "percent", 1, "rounds"),
  trade: metric("Trade/R", "perRound", 2, "rounds"),
  traded: metric("Traded%", "percent", 1, "deaths"),
  utility: metric("Util/R", "perRound", 2, "rounds"),
  flashAssist: metric("FA/R", "perRound", 2, "rounds"),
  blindPerFlash: metric("Blind/Flash", "seconds", 1, "flashes"),
  netBlindPerFlash: metric("Net Blind/Flash", "seconds", 1, "flashes"),
  hePerRound: metric("HE/R", "perRound", 2, "rounds"),
  firePerRound: metric("Fire/R", "perRound", 2, "rounds"),
  smokePerRound: metric("Smoke/R", "perRound", 2, "rounds"),
  utilityKills: metric("Utility kills/R", "perRound", 2, "rounds"),
  clutch: metric("Clutch%", "percent", 1, "attempts"),
  clutchFrequency: metric("Frequency/R", "perRound", 2, "rounds"),
  pistol: metric("Pistol%", "percent", 1, "pistolRounds"),
  roundWin: metric("RW%", "percent", 1, "rounds"),
  conversion: metric("R2 Conv", "percent", 1, "opportunities"),
  break: metric("R2 Break", "percent", 1, "opportunities"),
  fiveVFour: metric("5v4", "percent", 1, "opportunities"),
  fourVFive: metric("4v5", "percent", 1, "opportunities"),
  ecoSemi: metric("Eco/Semi", "percent", 1, "opportunities"),
  plantConversion: metric("Plant conv", "percent", 1, "plants"),
  headshot: metric("HS%", "percent", 1, "kills"),
  killShare: metric("Kill share", "percent", 1, "weaponKills"),
  killsPerRound: metric("Kills/R", "perRound", 2, "rounds"),
  damagePerRound: metric("DMG/R", "perRound", 1, "rounds"),
  rounds: metric("Rounds", "count", 0, "rounds"),
  maps: metric("Maps", "count", 0, "maps"),
} as const;

export type StatsMetricKey = keyof typeof STATS_METRICS;
