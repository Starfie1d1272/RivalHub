import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  bigint,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";
import type {
  Baseline,
  Choices,
  Pick,
  PredictionRules,
  SimStage,
} from "@/lib/predictions/types";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const predictionPrograms = pgTable("prediction_programs", {
  seasonId: uuid("season_id")
    .primaryKey()
    .references(() => seasons.id),
  rules: jsonb("rules").$type<PredictionRules>().notNull(),
  paused: boolean("paused").notNull().default(false),
  createdAt: time("created_at")
    .notNull()
    .default(sql`clock_timestamp()`),
});
export const predictionContests = pgTable(
  "prediction_contests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => predictionPrograms.seasonId),
    stageKey: text("stage_key").notNull(),
    kind: text("kind", { enum: ["swiss", "single_elim"] }).notNull(),
    entrants: jsonb("entrants")
      .$type<{ teamId: string; seed: number }[]>()
      .notNull(),
    deadline: time("deadline").notNull(),
    lockedAt: time("locked_at"),
    voidedAt: time("voided_at"),
    voidReason: text("void_reason"),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique().on(t.seasonId, t.stageKey),
    unique().on(t.id, t.seasonId),
    check("prediction_contest_kind", sql`${t.kind} IN ('swiss','single_elim')`),
  ],
);
export const predictionAccounts = pgTable(
  "prediction_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => predictionPrograms.seasonId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    joinedAt: time("joined_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [unique().on(t.seasonId, t.userId), unique().on(t.id, t.seasonId)],
);
export const predictionPicks = pgTable(
  "prediction_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull(),
    contestId: uuid("contest_id").notNull(),
    accountId: uuid("account_id").notNull(),
    version: integer("version").notNull(),
    requestId: uuid("request_id").notNull(),
    submitted: boolean("submitted").notNull(),
    pick: jsonb("pick").$type<Pick>().notNull(),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique().on(t.accountId, t.requestId),
    unique().on(t.contestId, t.accountId, t.version),
    foreignKey({
      columns: [t.contestId, t.seasonId],
      foreignColumns: [predictionContests.id, predictionContests.seasonId],
    }),
    foreignKey({
      columns: [t.accountId, t.seasonId],
      foreignColumns: [predictionAccounts.id, predictionAccounts.seasonId],
    }),
    check("prediction_pick_version", sql`${t.version} > 0`),
  ],
);
export const predictionJudgements = pgTable("prediction_judgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  contestId: uuid("contest_id")
    .notNull()
    .references(() => predictionContests.id),
  fingerprint: text("fingerprint").notNull(),
  actual: jsonb("actual").$type<Pick | null>(),
  createdAt: time("created_at")
    .notNull()
    .default(sql`clock_timestamp()`),
});
export const predictionMarkets = pgTable(
  "prediction_markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => predictionPrograms.seasonId),
    // Preserve identity when official recovery deletes/replaces a match. No cascading match FK.
    matchId: uuid("match_id").notNull().unique(),
    stageKey: text("stage_key").notNull(),
    a: uuid("entry_a_id").notNull(),
    b: uuid("entry_b_id").notNull(),
    deadline: time("deadline").notNull(),
    lockedAt: time("locked_at"),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique().on(t.id, t.seasonId),
    check("prediction_market_pair", sql`${t.a} <> ${t.b}`),
  ],
);
export const predictionStakes = pgTable(
  "prediction_stakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull(),
    marketId: uuid("market_id").notNull(),
    accountId: uuid("account_id").notNull(),
    side: uuid("side").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    requestId: uuid("request_id").notNull(),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique().on(t.accountId, t.requestId),
    foreignKey({
      columns: [t.marketId, t.seasonId],
      foreignColumns: [predictionMarkets.id, predictionMarkets.seasonId],
    }),
    foreignKey({
      columns: [t.accountId, t.seasonId],
      foreignColumns: [predictionAccounts.id, predictionAccounts.seasonId],
    }),
    check("prediction_stake_positive", sql`${t.amount} > 0`),
  ],
);
export const predictionSettlements = pgTable(
  "prediction_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => predictionMarkets.id),
    fingerprint: text("fingerprint").notNull(),
    state: text("state", {
      enum: ["pending", "settled", "refunded"],
    }).notNull(),
    winner: uuid("winner"),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "prediction_settlement_state",
      sql`${t.state} IN ('pending','settled','refunded')`,
    ),
  ],
);
export const predictionLedger = pgTable(
  "prediction_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull(),
    accountId: uuid("account_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    profit: bigint("profit", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    kind: text("kind", {
      enum: [
        "initial",
        "stage",
        "participation",
        "stake",
        "settlement",
        "reversal",
      ],
    }).notNull(),
    source: text("source").notNull(),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique().on(t.accountId, t.source),
    foreignKey({
      columns: [t.accountId, t.seasonId],
      foreignColumns: [predictionAccounts.id, predictionAccounts.seasonId],
    }),
    check(
      "prediction_ledger_kind",
      sql`${t.kind} IN ('initial','stage','participation','stake','settlement','reversal')`,
    ),
  ],
);
export const predictionScenarios = pgTable("prediction_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id")
    .notNull()
    .references(() => predictionPrograms.seasonId),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  baseline: jsonb("baseline").$type<Baseline>().notNull(),
  choices: jsonb("choices").$type<Choices>().notNull(),
  projection: jsonb("projection").$type<SimStage[]>().notNull(),
  createdAt: time("created_at")
    .notNull()
    .default(sql`clock_timestamp()`),
});
/** Durable outbox, enqueued atomically with official changes. Worker failure leaves it dirty. */
export const predictionJobs = pgTable("prediction_jobs", {
  seasonId: uuid("season_id")
    .primaryKey()
    .references(() => predictionPrograms.seasonId),
  dirty: boolean("dirty").notNull().default(true),
  updatedAt: time("updated_at")
    .notNull()
    .default(sql`clock_timestamp()`),
});

/** First observed official stage launch survives StageRun recovery/recreation. */
export const predictionStageMilestones = pgTable(
  "prediction_stage_milestones",
  {
    seasonId: uuid("season_id")
      .notNull()
      .references(() => predictionPrograms.seasonId),
    stageKey: text("stage_key").notNull(),
    openedAt: time("opened_at").notNull(),
  },
  (t) => [unique().on(t.seasonId, t.stageKey)],
);
