import { z, type ZodTypeAny } from "zod";

const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const side = z.enum(["t", "ct", "unknown"]);
const nullInt = z.number().int().nullable().optional();
const nullReal = z.number().nullable().optional();
const nullStr = z.string().nullable().optional();
const nullBool = z.boolean().nullable().optional();
const nullSide = side.nullable().optional();

// manifest.json
export const manifestSchema = z.object({
  schemaVersion: z.literal("rivalhub-demo-export/1"),
  exporter: z.object({ name: z.string(), version: z.string() }).optional(),
  parser: z.object({ name: z.string(), version: z.string() }).optional(),
  demo: z.object({ hash: z.string(), sourceFileName: z.string().optional() }).optional(),
  mapName: z.string(),
  tickrate: z.number().int(),
  exportedAt: z.string().optional(),
  files: z.record(z.string()),
});
export type Manifest = z.infer<typeof manifestSchema>;

// match.json（单对象）
export const matchSchema = z.object({
  mapName: z.string().optional(),
  tickrate: z.number().int().optional(),
  durationSeconds: z.number().optional(),
  serverName: z.string().optional(),
  source: z.string().optional(),
  teamA: z.object({ teamKey: z.string(), name: z.string(), score: z.number() }).optional(),
  teamB: z.object({ teamKey: z.string(), name: z.string(), score: z.number() }).optional(),
});

// players.json
const playerRowSchema = z.object({
  steamId64: z.string(),
  name: z.string(),
  teamKey: z.string(),
});
export const playersSchema = z.array(playerRowSchema);

// rounds.json
const roundRowSchema = z.object({
  roundNumber: z.number().int(),
  startTick: nullInt,
  freezeEndTick: nullInt,
  endTick: nullInt,
  teamASide: nullSide,
  teamBSide: nullSide,
  teamAScoreBefore: nullInt,
  teamBScoreBefore: nullInt,
  teamAEconomy: z.unknown().optional(),
  teamBEconomy: z.unknown().optional(),
  winnerTeamKey: nullStr,
  winnerSide: nullSide,
  endReason: nullStr,
});
export const roundsSchema = z.array(roundRowSchema);

// player-stats.json
const playerStatsRowSchema = z.object({
  steamId64: z.string(),
  teamKey: z.string(),
  kills: nullInt,
  deaths: nullInt,
  assists: nullInt,
  damageHealth: nullInt,
  damageArmor: nullInt,
  adr: nullReal,
  utilityDamage: nullInt,
  averageUtilityDamagePerRound: nullReal,
  headshotCount: nullInt,
  firstKillCount: nullInt,
  firstDeathCount: nullInt,
  tradeKillCount: nullInt,
  tradeDeathCount: nullInt,
  kast: nullReal,
  oneKillCount: nullInt,
  twoKillCount: nullInt,
  threeKillCount: nullInt,
  fourKillCount: nullInt,
  fiveKillCount: nullInt,
  vsOneCount: nullInt,
  vsOneWonCount: nullInt,
  vsOneLostCount: nullInt,
  vsTwoCount: nullInt,
  vsTwoWonCount: nullInt,
  vsTwoLostCount: nullInt,
  vsThreeCount: nullInt,
  vsThreeWonCount: nullInt,
  vsThreeLostCount: nullInt,
  vsFourCount: nullInt,
  vsFourWonCount: nullInt,
  vsFourLostCount: nullInt,
  vsFiveCount: nullInt,
  vsFiveWonCount: nullInt,
  vsFiveLostCount: nullInt,
  bombPlantedCount: nullInt,
  bombDefusedCount: nullInt,
  wallbangKillCount: nullInt,
  noScopeKillCount: nullInt,
  collateralKillCount: nullInt,
  /** 地图总回合数（exporter v2.1.2+ 新增，旧版为 null） */
  rounds: nullInt,
});
export const playerStatsSchema = z.array(playerStatsRowSchema);

// player-economies.json
const playerEconomyRowSchema = z.object({
  roundNumber: z.number().int(),
  steamId64: z.string(),
  teamKey: nullStr,
  side: nullSide,
  startMoney: nullInt,
  moneySpent: nullInt,
  equipmentValue: nullInt,
  type: nullStr,
});
export const playerEconomiesSchema = z.array(playerEconomyRowSchema);

// kills.json
const killRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: z.number().int(),
  killerSteamId64: nullStr,
  victimSteamId64: nullStr,
  assisterSteamId64: nullStr,
  killerTeamKey: nullStr,
  victimTeamKey: nullStr,
  killerSide: nullSide,
  victimSide: nullSide,
  weapon: nullStr,
  headshot: nullBool,
  flashAssist: nullBool,
  tradeKill: nullBool,
  tradeDeath: nullBool,
  throughSmoke: nullBool,
  noScope: nullBool,
  penetratedObjects: nullInt,
  killerPosition: vec3.nullable().optional(),
  victimPosition: vec3.nullable().optional(),
});
export const killsSchema = z.array(killRowSchema);

// damages.json
const damageRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: z.number().int(),
  attackerSteamId64: nullStr,
  victimSteamId64: nullStr,
  attackerTeamKey: nullStr,
  victimTeamKey: nullStr,
  attackerSide: nullSide,
  victimSide: nullSide,
  weapon: nullStr,
  hitgroup: nullStr,
  healthDamage: nullInt,
  armorDamage: nullInt,
  victimHealthBefore: nullInt,
  victimHealthAfter: nullInt,
  victimArmorBefore: nullInt,
  victimArmorAfter: nullInt,
});
export const damagesSchema = z.array(damageRowSchema);

// blinds.json
const blindRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: z.number().int(),
  flasherSteamId64: nullStr,
  flashedSteamId64: nullStr,
  flasherTeamKey: nullStr,
  flashedTeamKey: nullStr,
  flasherSide: nullSide,
  flashedSide: nullSide,
  durationSeconds: nullReal,
});
export const blindsSchema = z.array(blindRowSchema);

// bombs.json
const bombRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: z.number().int(),
  type: nullStr,
  site: nullStr,
  actorSteamId64: nullStr,
  actorTeamKey: nullStr,
  actorSide: nullSide,
  position: vec3.nullable().optional(),
});
export const bombsSchema = z.array(bombRowSchema);

// clutches.json
const clutchRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: nullInt,
  clutcherSteamId64: nullStr,
  clutcherTeamKey: nullStr,
  clutcherSide: nullSide,
  opponentCount: nullInt,
  won: nullBool,
  survived: nullBool,
  killCount: nullInt,
});
export const clutchesSchema = z.array(clutchRowSchema);

// grenades.json
const grenadeRowSchema = z.object({
  roundNumber: z.number().int(),
  throwTick: nullInt,
  effectTick: nullInt,
  grenade: nullStr,
  throwerSteamId64: nullStr,
  throwerTeamKey: nullStr,
  throwerSide: nullSide,
  throwPosition: vec3.nullable().optional(),
  effectPosition: vec3.nullable().optional(),
});
export const grenadesSchema = z.array(grenadeRowSchema);

// shots.json
const shotRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: z.number().int(),
  steamId64: nullStr,
  teamKey: nullStr,
  side: nullSide,
  weapon: nullStr,
  position: vec3.nullable().optional(),
  velocity: vec3.nullable().optional(),
  yaw: nullReal,
  pitch: nullReal,
});
export const shotsSchema = z.array(shotRowSchema);

// positions-1s.json
const positionRowSchema = z.object({
  roundNumber: z.number().int(),
  tick: z.number().int(),
  steamId64: z.string(),
  teamKey: nullStr,
  side: nullSide,
  alive: nullBool,
  position: vec3.nullable().optional(),
  yaw: nullReal,
  pitch: nullReal,
  health: nullInt,
  armor: nullInt,
  money: nullInt,
  activeWeapon: nullStr,
  flashDurationRemaining: nullReal,
  hasBomb: nullBool,
  hasDefuseKit: nullBool,
});
export const positionsSchema = z.array(positionRowSchema);

// manifest.files key → schema 映射（parse-package.ts 用）
export const FILE_SCHEMAS: Record<string, ZodTypeAny> = {
  match: matchSchema,
  players: playersSchema,
  rounds: roundsSchema,
  playerStats: playerStatsSchema,
  playerEconomies: playerEconomiesSchema,
  kills: killsSchema,
  damages: damagesSchema,
  blinds: blindsSchema,
  bombs: bombsSchema,
  clutches: clutchesSchema,
  grenades: grenadesSchema,
  shots: shotsSchema,
  positions1s: positionsSchema,
};
