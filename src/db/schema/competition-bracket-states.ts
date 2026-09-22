import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BracketDatabase as Database } from "@/lib/bracket";
import { seasons } from "./seasons";

/**
 * Persisted brackets-manager state for a logical stage.
 *
 * The stage key is part of the storage identity.  A competition may contain
 * more than one provider-backed stage and provider ids are only meaningful
 * inside the stage that owns them.
 */
export const competitionStageBracketStates = pgTable("competition_stage_bracket_states", {
  competitionId: uuid("competition_id")
    .notNull()
    .references(() => seasons.id, { onDelete: "cascade" }),
  stageKey: text("stage_key").notNull(),
  data: jsonb("data").$type<Database>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  identity: primaryKey({
    columns: [t.competitionId, t.stageKey],
    name: "competition_stage_bracket_states_pkey",
  }),
}));

export type CompetitionStageBracketState = typeof competitionStageBracketStates.$inferSelect;
export type NewCompetitionStageBracketState = typeof competitionStageBracketStates.$inferInsert;
