import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0002_windy_iron_man.sql"),
  "utf8",
);

describe("Team Registration 2.0 migration", () => {
  it("keeps applications separate from formal team provenance", () => {
    expect(migration).toContain('CREATE TABLE "team_applications"');
    expect(migration).toContain('CREATE TABLE "team_application_members"');
    expect(migration).toContain('"teams_source_provenance_check"');
    expect(migration).toContain('"team_members_source_provenance_check"');
    expect(migration).toContain('"teams_team_application_id_unique"');
    expect(migration).toContain('"team_members_team_application_member_id_unique"');
  });

  it("keeps new participant aggregates deny-by-default in the Data API", () => {
    expect(migration).toContain('ALTER TABLE "team_applications" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "team_application_members" ENABLE ROW LEVEL SECURITY');
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*(team_applications|team_application_members)/);
  });
});
