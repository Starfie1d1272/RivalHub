import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BracketDatabase as Database } from "@/lib/bracket";
import { seasons } from "./seasons";

/** The one persisted brackets-manager state owned by a competition. */
export const competitionBracketStates = pgTable("competition_bracket_states", {
  competitionId: uuid("competition_id")
    .primaryKey()
    .references(() => seasons.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Database>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompetitionBracketState = typeof competitionBracketStates.$inferSelect;
export type NewCompetitionBracketState = typeof competitionBracketStates.$inferInsert;
