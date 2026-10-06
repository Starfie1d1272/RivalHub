import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, bigint, unique, foreignKey, check, index } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";
import type { BetSubject, MarketType } from "@/lib/bet/types";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const betPrograms = pgTable("bet_programs", {
  seasonId: uuid("season_id").primaryKey().references(() => seasons.id),
  paused: boolean("paused").notNull().default(false),
  dirty: boolean("dirty").notNull().default(true),
  updatedAt: time("updated_at").notNull().default(sql`clock_timestamp()`),
  createdAt: time("created_at").notNull().default(sql`clock_timestamp()`),
});
export const betAccounts = pgTable("bet_accounts", {
  id: uuid("id").primaryKey().defaultRandom(), seasonId: uuid("season_id").notNull().references(() => betPrograms.seasonId),
  userId: uuid("user_id").notNull().references(() => users.id), joinedAt: time("joined_at").notNull().default(sql`clock_timestamp()`),
}, t => [unique().on(t.seasonId,t.userId), unique().on(t.id,t.seasonId)]);
export const betMarkets = pgTable("bet_markets", {
  id: uuid("id").primaryKey().defaultRandom(), seasonId: uuid("season_id").notNull().references(() => betPrograms.seasonId),
  // Identity survives official match recovery/deletion. Never cascade financial records.
  matchId: uuid("match_id"), marketKey: text("market_key").notNull(), type: text("type").$type<MarketType>().notNull(),
  subject: jsonb("subject").$type<BetSubject>().notNull(), line: integer("line_twice"),
  lockedAt: time("locked_at"), voidedAt: time("voided_at"), voidReason: text("void_reason"),
  createdAt: time("created_at").notNull().default(sql`clock_timestamp()`),
}, t => [unique().on(t.seasonId,t.marketKey),unique().on(t.id,t.seasonId),index("bet_markets_match_idx").on(t.matchId),check("bet_line_half",sql`${t.line} IS NULL OR (${t.line} > 0 AND ${t.line} % 2 = 1)`)]);
export const betOptions = pgTable("bet_options", {
  id: uuid("id").primaryKey().defaultRandom(),marketId: uuid("market_id").notNull().references(() => betMarkets.id),
  key: text("key").notNull(),label: text("label").notNull(),position: integer("position").notNull(),
},t=>[unique().on(t.marketId,t.key),unique().on(t.id,t.marketId),unique().on(t.marketId,t.position)]);
export const betStakes = pgTable("bet_stakes", {
  id: uuid("id").primaryKey().defaultRandom(),seasonId: uuid("season_id").notNull(),marketId: uuid("market_id").notNull(),accountId: uuid("account_id").notNull(),optionId: uuid("option_id").notNull(),
  amount: bigint("amount",{mode:"bigint"}).notNull(),requestId: uuid("request_id").notNull(),
  allIn: boolean("all_in").notNull().default(false),createdAt: time("created_at").notNull().default(sql`clock_timestamp()`),
},t=>[unique().on(t.accountId,t.requestId),
  foreignKey({columns:[t.marketId,t.seasonId],foreignColumns:[betMarkets.id,betMarkets.seasonId]}),
  foreignKey({columns:[t.accountId,t.seasonId],foreignColumns:[betAccounts.id,betAccounts.seasonId]}),
  foreignKey({columns:[t.optionId,t.marketId],foreignColumns:[betOptions.id,betOptions.marketId]}),
  index("bet_stakes_market_idx").on(t.marketId,t.optionId),check("bet_stake_positive",sql`${t.amount} > 0`)]);
export const betSettlements = pgTable("bet_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),marketId: uuid("market_id").notNull().references(()=>betMarkets.id),revision: integer("revision").notNull(),
  fingerprint: text("fingerprint").notNull(),state:text("state").$type<"pending"|"settled"|"refunded">().notNull(),winningOptionIds:jsonb("winning_option_ids").$type<string[]>().notNull(),
  createdAt:time("created_at").notNull().default(sql`clock_timestamp()`),
},t=>[unique().on(t.marketId,t.revision),check("bet_settlement_state",sql`${t.state} IN ('pending','settled','refunded')`)]);
export const betLedger = pgTable("bet_ledger",{
  id:uuid("id").primaryKey().defaultRandom(),seasonId:uuid("season_id").notNull(),accountId:uuid("account_id").notNull(),
  amount:bigint("amount",{mode:"bigint"}).notNull(),profit:bigint("profit",{mode:"bigint"}).notNull().default(sql`0`),
  kind:text("kind").$type<"initial"|"stage"|"stake"|"settlement"|"reversal">().notNull(),source:text("source").notNull(),
  createdAt:time("created_at").notNull().default(sql`clock_timestamp()`),
},t=>[unique().on(t.accountId,t.source),foreignKey({columns:[t.accountId,t.seasonId],foreignColumns:[betAccounts.id,betAccounts.seasonId]}),index("bet_ledger_account_idx").on(t.seasonId,t.accountId),check("bet_ledger_kind",sql`${t.kind} IN ('initial','stage','stake','settlement','reversal')`)]);
export const betStageMilestones = pgTable("bet_stage_milestones",{
  seasonId:uuid("season_id").notNull().references(()=>betPrograms.seasonId),stageKey:text("stage_key").notNull(),openedAt:time("opened_at").notNull(),
},t=>[unique().on(t.seasonId,t.stageKey)]);
