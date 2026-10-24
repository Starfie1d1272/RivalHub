import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { matchMaps } from "./match-maps";

/** Actor-scoped durable acknowledgement; contains no image or submitted rows. */
export const operatorScoreboardReceipts = pgTable("operator_scoreboard_receipts", {
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  operationId: uuid("operation_id").notNull(),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id, { onDelete: "cascade" }),
  operation: text("operation").$type<"save" | "clear">().notNull(),
  payloadDigest: text("payload_digest").notNull(),
  baseVersion: text("base_version").notNull(),
  resultVersion: text("result_version").notNull(),
  resultCount: integer("result_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.actorUserId, t.operationId] }),
  index("operator_scoreboard_receipts_map_idx").on(t.mapId),
  check("operator_scoreboard_receipts_operation_check", sql`${t.operation} IN ('save','clear')`),
  check("operator_scoreboard_receipts_digest_check", sql`${t.payloadDigest} ~ '^[0-9a-f]{64}$' AND ${t.baseVersion} ~ '^[0-9a-f]{64}$' AND ${t.resultVersion} ~ '^[0-9a-f]{64}$'`),
  check("operator_scoreboard_receipts_count_check", sql`${t.resultCount} >= 0`),
]).enableRLS();
