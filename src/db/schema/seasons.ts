import { pgTable, uuid, text, integer, boolean, timestamp, pgEnum, json } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Database } from "brackets-manager";
import type { RegistrationConfig, StagePlan } from "@/types/season";

export const seasonStatusEnum = pgEnum("season_status", [
  "draft",        // 未发布
  "registration", // 报名开放
  "voting",       // 队长投票
  "drafting",     // 蛇形选秀
  "playing",      // 正赛进行
  "finished",     // 赛季结束
  "archived",     // 历史归档
]);

// 报名模式：solo = 个人报名，team = 队伍整体报名
export const registrationModeEnum = pgEnum("registration_mode", ["solo", "team"]);

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // 自由文本标记，仅用于展示/筛选，业务逻辑不得读取此字段做功能分支
  kind: text("kind").notNull(),
  status: seasonStatusEnum("status").notNull().default("draft"),
  themeColor: text("theme_color"),

  // ── Capability 字段（业务逻辑的唯一判断依据）──────────────────────────
  // 报名模式
  registrationMode: registrationModeEnum("registration_mode").notNull().default("solo"),
  // 是否有队长投票环节
  hasCaptainVoting: boolean("has_captain_voting").notNull().default(true),
  // 是否有蛇形选秀环节
  hasDraft: boolean("has_draft").notNull().default(true),
  // 赛制阶段计划；matches.stage 存这里的 StageConfig.key
  stagePlan: json("stage_plan").$type<StagePlan>().notNull().default(sql`'[]'::json`),
  // 报名配置；缺失字段由应用层 fallback 到默认配置
  registrationConfig: json("registration_config")
    .$type<RegistrationConfig>()
    .notNull()
    .default(sql`'{}'::json`),
  // 每支队伍总人数（含队长）
  teamSize: integer("team_size").notNull().default(7),
  // 首发人数
  starterCount: integer("starter_count").notNull().default(5),
  // 该赛季可用的位置标识符列表（应用层 Zod 校验报名时引用此列表）
  positions: text("positions").array().notNull().default(sql`ARRAY['igl','awper','opener','closer','anchor']`),
  // ──────────────────────────────────────────────────────────────────────

  // brackets-manager 序列化数据（生成赛程后写入，供 advanceMatch 重建状态机）
  bracketData: json("bracket_data").$type<Database>(),

  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;
