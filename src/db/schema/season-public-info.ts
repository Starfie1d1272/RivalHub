import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";

export const communityGroupStatusEnum = pgEnum("community_group_status", ["active", "closed"]);

export const seasonPublicInfo = pgTable("season_public_info", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  rulesLabel: text("rules_label").notNull().default("赛事规则"),
  rulesHref: text("rules_href").notNull().default("/rules"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonUnique: unique("season_public_info_season_unique").on(t.seasonId),
}));

export const communityGroups = pgTable("community_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  audience: text("audience"),
  groupNumber: text("group_number"),
  qrImagePath: text("qr_image_path"),
  joinUrl: text("join_url"),
  note: text("note"),
  status: communityGroupStatusEnum("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeJoinMethod: check(
    "community_groups_active_join_method_check",
    sql`${t.status} = 'closed' OR ${t.qrImagePath} IS NOT NULL OR ${t.groupNumber} IS NOT NULL OR ${t.joinUrl} IS NOT NULL`,
  ),
  seasonOrderIndex: index("community_groups_season_sort_order_idx").on(t.seasonId, t.sortOrder, t.createdAt),
}));

export const seasonContacts = pgTable("season_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  publicName: text("public_name"),
  value: text("value").notNull(),
  href: text("href"),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonOrderIndex: index("season_contacts_season_sort_order_idx").on(t.seasonId, t.sortOrder, t.createdAt),
}));

export type SeasonPublicInfo = typeof seasonPublicInfo.$inferSelect;
export type NewSeasonPublicInfo = typeof seasonPublicInfo.$inferInsert;
export type CommunityGroup = typeof communityGroups.$inferSelect;
export type NewCommunityGroup = typeof communityGroups.$inferInsert;
export type SeasonContact = typeof seasonContacts.$inferSelect;
export type NewSeasonContact = typeof seasonContacts.$inferInsert;
