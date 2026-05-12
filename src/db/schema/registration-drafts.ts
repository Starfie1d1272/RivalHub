import { pgTable, uuid, text, timestamp, json, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";

export const registrationDrafts = pgTable(
  "registration_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    payload: json("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::json`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueSeasonEmail: unique().on(t.seasonId, t.email),
  }),
);

export type RegistrationDraft = typeof registrationDrafts.$inferSelect;
export type NewRegistrationDraft = typeof registrationDrafts.$inferInsert;
