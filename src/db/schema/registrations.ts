import { pgTable, uuid, text, boolean, timestamp, integer, real, pgEnum, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { seasons } from "./seasons";

export const registrationStatusEnum = pgEnum("registration_status", [
  "pending",
  "approved",
  "rejected",
  "waitlisted",
]);

export const seasonRegistrations = pgTable(
  "season_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    seasonId: uuid("season_id").notNull().references(() => seasons.id),

    // ── 身份类型 ─────────────────────────────────────
    playerType: text("player_type").notNull().default("enrolled"),

    // ── 位置 ─────────────────────────────────────────
    primaryPosition: text("primary_position").notNull(),
    secondaryPosition: text("secondary_position").notNull(), // 不能与主选相同

    // ── 段位 · 历史最高 ──────────────────────────────
    peakRank: text("peak_rank").notNull(),              // e.g. "A+"
    peakRankSeason: text("peak_rank_season").notNull(),  // e.g. "S1 2026"
    // rating：完美平台 Rating，0.01–3.00，两位小数
    peakRating: real("peak_rating").notNull(),
    // WE：Win Effect，0.0–16.0，一位小数
    peakWe: real("peak_we"),

    // ── 段位 · 当前赛季最高 ──────────────────────────
    currentSeasonPeakRank: text("current_season_peak_rank").notNull(),
    currentRating: real("current_rating").notNull(),
    currentWe: real("current_we"),

    // ── 截图（5 张天梯近期对局）─────────────────────
    screenshotUrls: text("screenshot_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // ── 风格与经历 ───────────────────────────────────
    gameplayStyle: text("gameplay_style").notNull(),     // ≤100 字
    competitionHistory: text("competition_history"),      // 可选
    highlightVideoUrl: text("highlight_video_url"),       // 可选

    // ── 其他 ─────────────────────────────────────────
    status: registrationStatusEnum("status").notNull().default("pending"),
    willingToBeCaptain: boolean("willing_to_be_captain").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // one registration per user per season
    uniqueUserSeason: unique().on(t.userId, t.seasonId),
  })
);

export type SeasonRegistration = typeof seasonRegistrations.$inferSelect;
export type NewSeasonRegistration = typeof seasonRegistrations.$inferInsert;
