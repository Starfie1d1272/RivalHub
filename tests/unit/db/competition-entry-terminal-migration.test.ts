import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "drizzle/migrations/0017_broad_doctor_octopus.sql"), "utf8");

describe("0017 terminal Team / CompetitionEntry migration", () => {
  it("retires season-bound identity tables after a fail-closed backfill", () => {
    expect(migration).toContain('ALTER TABLE "teams" RENAME TO "_legacy_season_teams"');
    expect(migration).toContain('ALTER TABLE "team_members" RENAME TO "_legacy_season_team_members"');
    expect(migration).toContain('DROP TABLE "_legacy_season_team_members"');
    expect(migration).toContain('DROP TABLE "_legacy_season_teams"');
    expect(migration).toContain('DROP TABLE "team_applications"');
    expect(migration).toContain('CompetitionEntry migration has unmapped canonical facts');
  });

  it("makes Entry the terminal entrant identity while preserving legacy provenance", () => {
    expect(migration).toContain('CREATE TABLE "competition_entries"');
    expect(migration).toContain('CREATE TABLE "competition_entry_legacy_identities"');
    expect(migration).toContain("team_application");
    expect(migration).toContain("season_team");
    expect(migration).toContain('competition_entry_id');
    expect(migration).not.toContain('runtime_team_id');
  });

  it("keeps commitment, frozen roster, and match lineup as separate facts", () => {
    expect(migration).toContain('CREATE TABLE "competition_entry_participants"');
    expect(migration).toContain('CREATE TABLE "event_rosters"');
    expect(migration).toContain('CREATE TABLE "event_roster_members"');
    expect(migration).toContain('event_roster_member_id');
  });

  it("migrates Rivals into event-native Entries and uses Entry foreign keys for matches and stages", () => {
    expect(migration).toContain("'event_native'");
    expect(migration).toContain('competition_entries_source_shape_check');
    expect(migration).toContain('major_stage_entrants_competition_entry_id');
    expect(migration).toContain('matches_entry_a_id');
  });
});
