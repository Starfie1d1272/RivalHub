import { describe, expect, it } from "vitest";
import { classifyMigrationRisk, MIGRATION_LOCKING_ANNOTATION } from "../../../scripts/db/migration-risk";

describe("migration risk classifier", () => {

  it("fails closed for destructive and unknown migration statements", () => {
    expect(classifyMigrationRisk("DROP TABLE old_teams;").risk).toBe("irreversible");
    expect(classifyMigrationRisk("UPDATE teams SET display_name = 'unknown';").unknownStatements).toHaveLength(1);
    expect(classifyMigrationRisk("UPDATE teams SET display_name = 'unknown';").risk).toBe("irreversible");
  });

  it("requires a locking review before classifying an existing-table index as forward-compatible", () => {
    expect(classifyMigrationRisk("CREATE INDEX teams_name_idx ON teams (name);").risk).toBe("irreversible");
    expect(classifyMigrationRisk(`${MIGRATION_LOCKING_ANNOTATION}\nCREATE INDEX teams_name_idx ON teams (name);`).risk).toBe("forward-compatible");
  });

});
