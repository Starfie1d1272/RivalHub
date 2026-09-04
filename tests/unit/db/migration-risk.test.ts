import { describe, expect, it } from "vitest";
import {
  classifyMigrationSql,
  extractMigrationContractOwners,
  MIGRATION_CONTRACT_ANNOTATION,
  MIGRATION_LOCKING_ANNOTATION,
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
    ["alter-type", `ALTER TYPE team_status ADD VALUE 'paused';`],
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
${MIGRATION_CONTRACT_ANNOTATION}
ALTER TABLE teams DROP COLUMN old_name;
`, "0033.sql");
    expect(annotated[0]?.annotation).toBe(
      "<reason>",
    );
    expect(annotated[0]?.annotationKind).toBe("contract-cleanup");

    const separatedByComment = classifyMigrationSql(`
${MIGRATION_CONTRACT_ANNOTATION}
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

  it.each([
    ["drop", MIGRATION_LOCKING_ANNOTATION, "DROP TABLE old_teams;"],
    ["rename", MIGRATION_LOCKING_ANNOTATION, "ALTER TABLE teams RENAME COLUMN old_name TO name;"],
    ["alter-type", MIGRATION_LOCKING_ANNOTATION, "ALTER TABLE teams ALTER COLUMN name TYPE text;"],
    ["set-not-null", MIGRATION_LOCKING_ANNOTATION, "ALTER TABLE teams ALTER COLUMN name SET NOT NULL;"],
    ["rewrite-or-exclusive-lock", MIGRATION_CONTRACT_ANNOTATION, "CREATE INDEX teams_name_idx ON teams (name);"],
    ["rewrite-or-exclusive-lock", MIGRATION_CONTRACT_ANNOTATION, "ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name);"],
  ] as const)("rejects %s with the wrong annotation", (_category, annotation, sql) => {
    const finding = classifyMigrationSql(`${annotation}\n${sql}`)[0];
    expect(finding?.category).toBe(_category);
    expect(finding?.annotation).toBeUndefined();
    expect(finding?.annotationKind).toBeUndefined();
  });

  it.each([
    ["CREATE INDEX", "CREATE INDEX teams_name_idx ON teams (name);"],
    ["ADD CONSTRAINT", "ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name);"],
  ] as const)("accepts locking-reviewed annotations for %s", (_label, sql) => {
    const finding = classifyMigrationSql(`${MIGRATION_LOCKING_ANNOTATION}\n${sql}`)[0];
    expect(finding).toMatchObject({ category: "rewrite-or-exclusive-lock", annotation: "<reason>", annotationKind: "locking-reviewed" });
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

  it("extracts quoted owners without treating keyword-shaped identifiers as SQL keywords", () => {
    const finding = classifyMigrationSql(`ALTER TABLE "drop" RENAME TO "table";`)[0];
    expect(finding?.category).toBe("rename");
    expect(finding ? extractMigrationContractOwners(finding) : []).toMatchObject([
      { kind: "relation", identifier: "drop", renamedTo: "table" },
    ]);
  });

  it("extracts every column owner from a multi-action DROP statement", () => {
    const finding = classifyMigrationSql(`ALTER TABLE teams DROP COLUMN old_name, DROP COLUMN old_code;`)[0];
    expect(finding ? extractMigrationContractOwners(finding) : []).toMatchObject([
      { kind: "column", relation: "teams", identifier: "old_name" },
      { kind: "column", relation: "teams", identifier: "old_code" },
    ]);
  });
});
