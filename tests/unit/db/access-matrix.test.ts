import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDatabaseAccessMatrixFacts,
  DATABASE_ACCESS_MATRIX,
  DATABASE_ACCESS_TABLES,
  renderDatabaseAccessMatrixMarkdown,
  validateDatabaseAccessMatrixConfig,
  type DatabaseAccessEntry,
  type DatabaseAccessFacts,
} from "../../../scripts/db/access-matrix";

const root = process.cwd();
function expectedFacts(): DatabaseAccessFacts[] {
  return DATABASE_ACCESS_MATRIX.map((entry) => ({
    table_name: entry.table,
    rls_enabled: entry.rlsEnabled,
    anon_privileges: [...entry.anonPrivileges],
    authenticated_privileges: [...entry.authenticatedPrivileges],
    policy_names: [...entry.policyNames],
    publication_membership: entry.publicationMembership,
  }));
}

describe("database access matrix", () => {
  it("classifies every current public application table and keeps the generated document aligned", () => {
    const latestSnapshot = readdirSync(join(root, "drizzle/migrations/meta")).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort().at(-1)!;
    const snapshot = JSON.parse(
      readFileSync(join(root, "drizzle/migrations/meta", latestSnapshot), "utf8"),
    ) as { tables: Record<string, unknown> };
    const snapshotTables = Object.keys(snapshot.tables)
      .map((table) => table.replace(/^public\./, ""))
      .sort();

    expect(DATABASE_ACCESS_MATRIX).toHaveLength(snapshotTables.length);
    expect(new Set(DATABASE_ACCESS_TABLES).size).toBe(DATABASE_ACCESS_TABLES.length);
    expect(snapshotTables).toEqual([...DATABASE_ACCESS_TABLES].sort());
    expect(renderDatabaseAccessMatrixMarkdown()).toBe(
      readFileSync(join(root, "docs/security/database-access-matrix.md"), "utf8"),
    );
  });

  it("fails closed for unclassified tables, unexpected grants, publication drift, and incomplete client policy declarations", () => {
    expect(() => assertDatabaseAccessMatrixFacts(DATABASE_ACCESS_TABLES, expectedFacts())).not.toThrow();

    const unexpectedGrantFacts = expectedFacts();
    unexpectedGrantFacts.find((row) => row.table_name === "competition_stage_bracket_states")!.anon_privileges = ["SELECT"];
    expect(() => assertDatabaseAccessMatrixFacts(DATABASE_ACCESS_TABLES, unexpectedGrantFacts)).toThrow(
      "competition_stage_bracket_states: anon privileges",
    );

    const unexpectedPublicationFacts = expectedFacts();
    unexpectedPublicationFacts.find((row) => row.table_name === "competition_stage_bracket_states")!.publication_membership = true;
    expect(() => assertDatabaseAccessMatrixFacts(DATABASE_ACCESS_TABLES, unexpectedPublicationFacts)).toThrow(
      "competition_stage_bracket_states: Realtime publication",
    );

    expect(() => assertDatabaseAccessMatrixFacts(
      [...DATABASE_ACCESS_TABLES, "future_table"],
      expectedFacts(),
    )).toThrow("public table unclassified future_table");
    expect(() => assertDatabaseAccessMatrixFacts(
      [...DATABASE_ACCESS_TABLES, "historical_table"],
      expectedFacts(),
      DATABASE_ACCESS_MATRIX,
      ["historical_table"],
    )).not.toThrow();

    const invalidClientEntry: DatabaseAccessEntry = {
      ...DATABASE_ACCESS_MATRIX[0],
      table: "client_probe",
      targetClass: "client_read_rls",
      rlsEnabled: false,
      policyNames: [],
    };
    expect(() => validateDatabaseAccessMatrixConfig([
      ...DATABASE_ACCESS_MATRIX,
      invalidClientEntry,
    ])).toThrow("client/realtime table client_probe 必须声明 RLS 和 policy");
  });

});
