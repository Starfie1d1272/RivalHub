import { describe, expect, it } from "vitest";
import {
  classifyMigrationSql,
  MIGRATION_RISK_ANNOTATION,
} from "../../../scripts/db/migration-risk";

describe("migration risk classifier", () => {
  it("does not classify additive DDL or concurrently-built indexes", () => {
    expect(classifyMigrationSql(`
      CREATE TABLE teams_next (id uuid PRIMARY KEY);
      CREATE INDEX CONCURRENTLY teams_next_id_idx ON teams_next (id);
    `)).toEqual([]);
  });

  it.each([
    ["drop", `DROP TABLE old_teams;`],
    ["rename", `ALTER TABLE teams RENAME COLUMN old_name TO name;`],
    ["alter-type", `ALTER TABLE teams ALTER COLUMN name TYPE varchar(160);`],
    ["set-not-null", `ALTER TABLE teams ALTER COLUMN name SET NOT NULL;`],
    ["rewrite-or-exclusive-lock", `CREATE INDEX teams_name_idx ON teams (name);`],
    ["rewrite-or-exclusive-lock", `ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name);`],
  ] as const)("classifies %s", (category, sql) => {
    expect(classifyMigrationSql(sql, "drizzle/migrations/0033_test.sql")).toMatchObject([
      { category, filePath: "drizzle/migrations/0033_test.sql", line: 1 },
    ]);
  });

  it("accepts the durable annotation only when it immediately precedes the statement", () => {
    const annotated = classifyMigrationSql(`
${MIGRATION_RISK_ANNOTATION}
ALTER TABLE teams DROP COLUMN old_name;
`, "0033.sql");
    expect(annotated[0]?.annotation).toBe(
      "contract cleanup after the previous release stopped reading/writing <old field>",
    );

    const separatedByComment = classifyMigrationSql(`
${MIGRATION_RISK_ANNOTATION}
-- this comment is not the durable risk annotation
ALTER TABLE teams DROP COLUMN old_name;
`);
    expect(separatedByComment[0]?.annotation).toBeUndefined();

    const wrongReason = classifyMigrationSql(`
-- rivalhub:migration-risk: reviewed by the team
ALTER TABLE teams DROP COLUMN old_name;
`);
    expect(wrongReason[0]?.annotation).toBeUndefined();
  });

  it("ignores SQL-looking text in comments, quoted identifiers, strings, and dollar bodies", () => {
    expect(classifyMigrationSql(`
      -- DROP TABLE commented_out;
      SELECT 'ALTER TABLE teams DROP COLUMN old_name';
      SELECT "DROP TABLE";
      DO $$
      BEGIN
        RAISE NOTICE 'ALTER TABLE teams SET NOT NULL';
      END
      $$;
    `)).toEqual([]);
  });
});
