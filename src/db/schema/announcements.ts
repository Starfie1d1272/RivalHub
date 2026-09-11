import { sql } from "drizzle-orm";
import { boolean, check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";

export const announcementScopeEnum = pgEnum("announcement_scope", ["site", "season"]);
export const announcementTypeEnum = pgEnum("announcement_type", ["notice", "product_update", "important_alert"]);
export const announcementStatusEnum = pgEnum("announcement_status", ["draft", "published"]);

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: announcementScopeEnum("scope").notNull(),
  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "cascade" }),
  type: announcementTypeEnum("type").notNull().default("notice"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: announcementStatusEnum("status").notNull().default("draft"),
  requiresAttention: boolean("requires_attention").notNull().default(false),
  attentionUntil: timestamp("attention_until", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  scopeSeasonShape: check(
    "announcements_scope_season_shape_check",
    sql`(${t.scope} = 'site' AND ${t.seasonId} IS NULL) OR (${t.scope} = 'season' AND ${t.seasonId} IS NOT NULL)`,
  ),
  seasonPublishedIndex: index("announcements_season_status_published_at_idx").on(t.seasonId, t.status, t.publishedAt),
  sitePublishedIndex: index("announcements_scope_status_published_at_idx").on(t.scope, t.status, t.publishedAt),
}));

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
