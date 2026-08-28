import { pgTable, uuid, text, integer, boolean, timestamp, unique, foreignKey, index } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";
import { seasonRegistrations } from "./registrations";
import { teamApplicationMembers, teamApplications } from "./team-applications";

// TODO: add team status enum if needed
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  captainRegistrationId: uuid("captain_registration_id")
    .references(() => seasonRegistrations.id),
  // Team-registration provenance. A formal Team has exactly one source:
  // legacy solo/draft registration or an approved team application.
  teamApplicationId: uuid("team_application_id")
    .unique()
    .references(() => teamApplications.id),
  // canonical captain identity（Rivals provenance 保留在 captainRegistrationId）
  captainUserId: uuid("captain_user_id").notNull().references(() => users.id),
  draftOrder: integer("draft_order"), // 1-based snake draft order; team registration has none
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonDraftOrder: unique().on(t.seasonId, t.draftOrder),
  // composite FK 目标（teams.id, teams.season_id）要求唯一约束
  uniqueIdSeason: unique().on(t.id, t.seasonId),
}));

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  registrationId: uuid("registration_id").references(() => seasonRegistrations.id),
  teamApplicationMemberId: uuid("team_application_member_id")
    .unique()
    .references(() => teamApplicationMembers.id),
  // canonical member identity（Rivals provenance 保留在 registrationId）
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  isStarter: boolean("is_starter").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueRegistration: unique().on(t.registrationId),
  // 同 season 同 user 只能属于一个正式队伍
  uniqueSeasonUser: unique().on(t.seasonId, t.userId),
  teamIndex: index("team_members_team_id_idx").on(t.teamId),
  // DB 层保证 teamMember.seasonId == parent team.seasonId
  teamSeasonFk: foreignKey({
    columns: [t.teamId, t.seasonId],
    foreignColumns: [teams.id, teams.seasonId],
    name: "team_members_team_season_fk",
  }),
}));

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
