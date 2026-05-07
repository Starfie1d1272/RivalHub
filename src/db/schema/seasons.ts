import { pgTable, uuid, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";

// `kind` 保留用于显示/归档标记，业务逻辑不得直接 if/switch kind
// 所有功能分支必须读 capability 字段（见下方）
export const seasonKindEnum = pgEnum("season_kind", ["rivals", "major"]);

export const seasonStatusEnum = pgEnum("season_status", [
  "draft",        // 未发布
  "registration", // 报名开放
  "voting",       // 队长投票
  "drafting",     // 蛇形选秀
  "playing",      // 正赛进行
  "finished",     // 赛季结束
  "archived",     // 历史归档
]);

// 报名模式：solo = 个人报名（Rivals），team = 队伍整体报名（Major v2）
export const registrationModeEnum = pgEnum("registration_mode", ["solo", "team"]);

// Bracket 类型
export const bracketTypeEnum = pgEnum("bracket_type", [
  "double_elim",
  "single_elim",
  "round_robin",
]);

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: seasonKindEnum("kind").notNull(),           // 仅用于展示与历史记录
  status: seasonStatusEnum("status").notNull().default("draft"),
  themeColor: text("theme_color"),

  // ── Capability 字段（业务逻辑的唯一判断依据）──────────────────────────
  // 报名模式
  registrationMode: registrationModeEnum("registration_mode").notNull().default("solo"),
  // 是否有队长投票环节
  hasCaptainVoting: boolean("has_captain_voting").notNull().default(true),
  // 是否有蛇形选秀环节
  hasDraft: boolean("has_draft").notNull().default(true),
  // Bracket 类型（null = 无淘汰赛阶段）
  bracketType: bracketTypeEnum("bracket_type").default("double_elim"),
  // 每支队伍总人数（含队长）
  teamSize: integer("team_size").notNull().default(7),
  // 首发人数
  starterCount: integer("starter_count").notNull().default(5),
  // ──────────────────────────────────────────────────────────────────────

  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;
