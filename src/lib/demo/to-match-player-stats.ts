export interface DemoStatInput {
  steamId64: string;
  teamKey: string;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  adr?: number | null;
  headshotCount?: number | null;
  firstKillCount?: number | null;
  threeKillCount?: number | null;
  fourKillCount?: number | null;
  fiveKillCount?: number | null;
  vsOneWonCount?: number | null;
  vsTwoWonCount?: number | null;
  vsThreeWonCount?: number | null;
  vsFourWonCount?: number | null;
  vsFiveWonCount?: number | null;
  [key: string]: unknown;
}

export interface MatchPlayerStatRow {
  perfectName: string;
  userId: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  adr: number | null;
  hsPercent: number | null;
  firstKills: number | null;
  multiKills: number | null;
  clutches: number | null;
  source: "demo_import";
  ratingPro?: undefined;
  rws?: undefined;
  we?: undefined;
}

export function toMatchPlayerStat(
  stat: DemoStatInput,
  perfectName: string,
  userId: string | null,
): MatchPlayerStatRow {
  const kills = stat.kills ?? 0;
  const hs = stat.headshotCount ?? 0;
  const hsPercent = kills > 0 ? Math.round((hs / kills) * 100) : 0;

  const multiKills =
    (stat.threeKillCount ?? 0) +
    (stat.fourKillCount ?? 0) +
    (stat.fiveKillCount ?? 0);

  const clutches =
    (stat.vsOneWonCount ?? 0) +
    (stat.vsTwoWonCount ?? 0) +
    (stat.vsThreeWonCount ?? 0) +
    (stat.vsFourWonCount ?? 0) +
    (stat.vsFiveWonCount ?? 0);

  return {
    perfectName,
    userId,
    kills: stat.kills ?? null,
    deaths: stat.deaths ?? null,
    assists: stat.assists ?? null,
    adr: stat.adr ?? null,
    hsPercent,
    firstKills: stat.firstKillCount ?? null,
    multiKills,
    clutches,
    source: "demo_import",
  };
}
