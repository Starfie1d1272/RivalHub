import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, unique, check } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";
import type { FreePredictionKind, FreePredictionSubject } from "@/lib/free-predictions/types";
const time = (name: string) => timestamp(name, { withTimezone: true });
// Match identity survives canonical recovery/deletion; missing facts void the projection.
export const freePredictionLocks = pgTable("free_prediction_locks", {
  matchId: uuid("match_id").primaryKey(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  resultLockedAt: time("result_locked_at"), bpLockedAt: time("bp_locked_at"),
}).enableRLS();
export const freePredictionChoices = pgTable("free_prediction_choices", {
  id: uuid("id").primaryKey().defaultRandom(), seasonId: uuid("season_id").notNull().references(() => seasons.id),
  matchId: uuid("match_id").notNull(), userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<FreePredictionKind>().notNull(),
  subject: jsonb("subject").$type<FreePredictionSubject>().notNull(),
  selection: jsonb("selection").$type<string[]>().notNull(),
  updatedAt: time("updated_at").notNull().default(sql`clock_timestamp()`),
}, t => [unique().on(t.userId, t.matchId, t.kind), check("free_prediction_kind", sql`${t.kind} in ('result','bp')`)]).enableRLS();
// Immutable retry receipts also preserve revisions; retry never restores an old choice.
export const freePredictionRequests = pgTable("free_prediction_requests", {
  id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull().references(() => users.id),
  requestId: uuid("request_id").notNull(), choiceId: uuid("choice_id").notNull().references(() => freePredictionChoices.id),
  selection: jsonb("selection").$type<string[]>().notNull(),
  createdAt: time("created_at").notNull().default(sql`clock_timestamp()`),
}, t => [unique().on(t.userId, t.requestId)]).enableRLS();
