import { pgTable, uuid, text, boolean, timestamp, integer, pgEnum, unique } from "drizzle-orm/pg-core";
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
    primaryPosition: text("primary_position").notNull(),
    secondaryPosition: text("secondary_position"),
    peakRating: integer("peak_rating"),
    screenshotUrl: text("screenshot_url"),
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
