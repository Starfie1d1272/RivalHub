import { pgTable, uuid, integer, real, text, boolean, timestamp, json, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { matchMaps } from "./match-maps";
import { users } from "./users";

type Vec3 = { x: number; y: number; z: number };
export const demoSideEnum = pgEnum("demo_side", ["t", "ct", "unknown"]);

// 一次导入批次（对应一张 demo 地图包）
export const demoImports = pgTable("demo_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  demoHash: text("demo_hash").notNull(),
  zipObjectPath: text("zip_object_path"),
  zipByteSize: integer("zip_byte_size"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>(),
  supersedesImportId: uuid("supersedes_import_id"),
  isCurrent: boolean("is_current").notNull().default(true),
  schemaVersion: text("schema_version").notNull(),
  exporterName: text("exporter_name"),
  exporterVersion: text("exporter_version"),
  parserName: text("parser_name"),
  mapName: text("map_name").notNull(),
  tickrate: integer("tickrate").notNull(),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  importedBy: uuid("imported_by").references(() => users.id),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mapCurrentIdx: index("demo_imports_map_current_idx").on(t.mapId, t.isCurrent),
  hashIdx: index("demo_imports_hash_idx").on(t.demoHash),
}));

// players.json
export const demoPlayers = pgTable("demo_players", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  steamId64: text("steam_id64").notNull(),
  name: text("name").notNull(),
  teamKey: text("team_key").notNull(),
  userId: uuid("user_id").references(() => users.id),
}, (t) => ({
  playersBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// rounds.json
export const demoRounds = pgTable("demo_rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(),
  startTick: integer("start_tick"),
  freezeEndTick: integer("freeze_end_tick"),
  endTick: integer("end_tick"),
  teamASide: demoSideEnum("team_a_side"),
  teamBSide: demoSideEnum("team_b_side"),
  teamAScoreBefore: integer("team_a_score_before"),
  teamBScoreBefore: integer("team_b_score_before"),
  teamAEconomy: text("team_a_economy"),
  teamBEconomy: text("team_b_economy"),
  winnerTeamKey: text("winner_team_key"),
  winnerSide: demoSideEnum("winner_side"),
  endReason: text("end_reason"),
}, (t) => ({
  roundsBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// player-stats.json（40 字段汇总）
export const demoPlayerStats = pgTable("demo_player_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  steamId64: text("steam_id64").notNull(),
  userId: uuid("user_id").references(() => users.id),
  teamKey: text("team_key").notNull(),
  kills: integer("kills"), deaths: integer("deaths"), assists: integer("assists"),
  damageHealth: integer("damage_health"), damageArmor: integer("damage_armor"),
  adr: real("adr"), utilityDamage: integer("utility_damage"),
  averageUtilityDamagePerRound: real("avg_utility_damage_per_round"),
  headshotCount: integer("headshot_count"),
  firstKillCount: integer("first_kill_count"), firstDeathCount: integer("first_death_count"),
  tradeKillCount: integer("trade_kill_count"), tradeDeathCount: integer("trade_death_count"),
  kast: real("kast"),
  oneKillCount: integer("one_kill_count"), twoKillCount: integer("two_kill_count"),
  threeKillCount: integer("three_kill_count"), fourKillCount: integer("four_kill_count"),
  fiveKillCount: integer("five_kill_count"),
  vsOneCount: integer("vs_one_count"), vsOneWonCount: integer("vs_one_won_count"), vsOneLostCount: integer("vs_one_lost_count"),
  vsTwoCount: integer("vs_two_count"), vsTwoWonCount: integer("vs_two_won_count"), vsTwoLostCount: integer("vs_two_lost_count"),
  vsThreeCount: integer("vs_three_count"), vsThreeWonCount: integer("vs_three_won_count"), vsThreeLostCount: integer("vs_three_lost_count"),
  vsFourCount: integer("vs_four_count"), vsFourWonCount: integer("vs_four_won_count"), vsFourLostCount: integer("vs_four_lost_count"),
  vsFiveCount: integer("vs_five_count"), vsFiveWonCount: integer("vs_five_won_count"), vsFiveLostCount: integer("vs_five_lost_count"),
  bombPlantedCount: integer("bomb_planted_count"), bombDefusedCount: integer("bomb_defused_count"),
  wallbangKillCount: integer("wallbang_kill_count"), noScopeKillCount: integer("no_scope_kill_count"),
  collateralKillCount: integer("collateral_kill_count"),
}, (t) => ({
  playerStatsBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// player-economies.json
export const demoPlayerEconomies = pgTable("demo_player_economies", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(),
  steamId64: text("steam_id64").notNull(),
  teamKey: text("team_key"), side: demoSideEnum("side"),
  startMoney: integer("start_money"), moneySpent: integer("money_spent"),
  equipmentValue: integer("equipment_value"), type: text("type"),
}, (t) => ({
  economiesBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// kills.json
export const demoKills = pgTable("demo_kills", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  killerSteamId64: text("killer_steam_id64"), victimSteamId64: text("victim_steam_id64"),
  assisterSteamId64: text("assister_steam_id64"),
  killerTeamKey: text("killer_team_key"), victimTeamKey: text("victim_team_key"),
  killerSide: demoSideEnum("killer_side"), victimSide: demoSideEnum("victim_side"),
  weapon: text("weapon"), headshot: boolean("headshot"), flashAssist: boolean("flash_assist"),
  tradeKill: boolean("trade_kill"), tradeDeath: boolean("trade_death"),
  throughSmoke: boolean("through_smoke"), noScope: boolean("no_scope"),
  penetratedObjects: integer("penetrated_objects"),
  killerPosition: json("killer_position").$type<Vec3>(),
  victimPosition: json("victim_position").$type<Vec3>(),
}, (t) => ({
  killsBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// damages.json
export const demoDamages = pgTable("demo_damages", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  attackerSteamId64: text("attacker_steam_id64"), victimSteamId64: text("victim_steam_id64"),
  attackerTeamKey: text("attacker_team_key"), victimTeamKey: text("victim_team_key"),
  attackerSide: demoSideEnum("attacker_side"), victimSide: demoSideEnum("victim_side"),
  weapon: text("weapon"), hitgroup: text("hitgroup"),
  healthDamage: integer("health_damage"), armorDamage: integer("armor_damage"),
  victimHealthBefore: integer("victim_health_before"), victimHealthAfter: integer("victim_health_after"),
  victimArmorBefore: integer("victim_armor_before"), victimArmorAfter: integer("victim_armor_after"),
}, (t) => ({
  damagesBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// blinds.json
export const demoBlinds = pgTable("demo_blinds", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  flasherSteamId64: text("flasher_steam_id64"), flashedSteamId64: text("flashed_steam_id64"),
  flasherTeamKey: text("flasher_team_key"), flashedTeamKey: text("flashed_team_key"),
  flasherSide: demoSideEnum("flasher_side"), flashedSide: demoSideEnum("flashed_side"),
  durationSeconds: real("duration_seconds"),
}, (t) => ({
  blindsBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// bombs.json
export const demoBombs = pgTable("demo_bombs", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  type: text("type"), site: text("site"),
  actorSteamId64: text("actor_steam_id64"), actorTeamKey: text("actor_team_key"),
  actorSide: demoSideEnum("actor_side"), position: json("position").$type<Vec3>(),
}, (t) => ({
  bombsBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// clutches.json
export const demoClutches = pgTable("demo_clutches", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick"),
  clutcherSteamId64: text("clutcher_steam_id64"), clutcherTeamKey: text("clutcher_team_key"),
  clutcherSide: demoSideEnum("clutcher_side"),
  opponentCount: integer("opponent_count"), won: boolean("won"),
  survived: boolean("survived"), killCount: integer("kill_count"),
}, (t) => ({
  clutchesBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// grenades.json
export const demoGrenades = pgTable("demo_grenades", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(),
  throwTick: integer("throw_tick"), effectTick: integer("effect_tick"),
  grenade: text("grenade"), throwerSteamId64: text("thrower_steam_id64"),
  throwerTeamKey: text("thrower_team_key"), throwerSide: demoSideEnum("thrower_side"),
  throwPosition: json("throw_position").$type<Vec3>(),
  effectPosition: json("effect_position").$type<Vec3>(),
}, (t) => ({
  grenadesBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// shots.json
export const demoShots = pgTable("demo_shots", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  steamId64: text("steam_id64"), teamKey: text("team_key"), side: demoSideEnum("side"),
  weapon: text("weapon"), position: json("position").$type<Vec3>(),
  velocity: json("velocity").$type<Vec3>(), yaw: real("yaw"), pitch: real("pitch"),
}, (t) => ({
  shotsBatchIdx: index().on(t.importBatchId, t.mapId),
}));

// positions-1s.json
export const demoPositions = pgTable("demo_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  importBatchId: uuid("import_batch_id").notNull().references(() => demoImports.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),
  roundNumber: integer("round_number").notNull(), tick: integer("tick").notNull(),
  steamId64: text("steam_id64").notNull(), teamKey: text("team_key"), side: demoSideEnum("side"),
  alive: boolean("alive"), position: json("position").$type<Vec3>(),
  yaw: real("yaw"), pitch: real("pitch"),
  health: integer("health"), armor: integer("armor"), money: integer("money"),
  activeWeapon: text("active_weapon"), flashDurationRemaining: real("flash_duration_remaining"),
  hasBomb: boolean("has_bomb"), hasDefuseKit: boolean("has_defuse_kit"),
}, (t) => ({
  positionsBatchIdx: index().on(t.importBatchId, t.mapId),
}));
