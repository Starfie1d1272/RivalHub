import { readFileSync } from "node:fs";
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
const migration = readFileSync(
  join(root, "drizzle/migrations/0034_database_access_boundary.sql"),
  "utf8",
);

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
    const snapshot = JSON.parse(
      readFileSync(join(root, "drizzle/migrations/meta/0034_snapshot.json"), "utf8"),
    ) as { tables: Record<string, unknown> };
    const snapshotTables = Object.keys(snapshot.tables)
      .map((table) => table.replace(/^public\./, ""))
      .sort();

    expect(DATABASE_ACCESS_MATRIX).toHaveLength(64);
    expect(new Set(DATABASE_ACCESS_TABLES).size).toBe(DATABASE_ACCESS_TABLES.length);
    expect(snapshotTables).toEqual([...DATABASE_ACCESS_TABLES].sort());
    expect(renderDatabaseAccessMatrixMarkdown()).toBe(
      readFileSync(join(root, "docs/security/database-access-matrix.md"), "utf8"),
    );
  });

  it("keeps the terminal migration and canonical contract deny-by-default", () => {
    const enabledTables = [...migration.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g)]
      .map((match) => match[1])
      .sort();

    expect(enabledTables).toEqual([...DATABASE_ACCESS_TABLES].sort());
    const publicationTablesBlock = migration.match(
      /SELECT unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\)/,
    )?.[1];
    expect(publicationTablesBlock).toBeDefined();
    const publicationTables = [...(publicationTablesBlock ?? "").matchAll(/'([^']+)'/g)]
      .map((match) => match[1])
      .sort();
    expect(publicationTables).toEqual([...DATABASE_ACCESS_TABLES].sort());
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;",
    );
    expect(migration).toContain("ALTER PUBLICATION %I DROP TABLE %I.%I");
    expect(() => validateDatabaseAccessMatrixConfig()).not.toThrow();
    expect(DATABASE_ACCESS_MATRIX.every((entry) =>
      entry.targetClass === "server_only" &&
      entry.anonPrivileges.length === 0 &&
      entry.authenticatedPrivileges.length === 0 &&
      entry.rlsEnabled &&
      entry.policyNames.length === 0 &&
      !entry.publicationMembership,
    )).toBe(true);
  });

  it("fails closed for unclassified tables, unexpected grants, publication drift, and incomplete client policy declarations", () => {
    expect(() => assertDatabaseAccessMatrixFacts(DATABASE_ACCESS_TABLES, expectedFacts())).not.toThrow();

    const unexpectedGrantFacts = expectedFacts();
    unexpectedGrantFacts.find((row) => row.table_name === "competition_bracket_states")!.anon_privileges = ["SELECT"];
    expect(() => assertDatabaseAccessMatrixFacts(DATABASE_ACCESS_TABLES, unexpectedGrantFacts)).toThrow(
      "competition_bracket_states: anon privileges",
    );

    const unexpectedPublicationFacts = expectedFacts();
    unexpectedPublicationFacts.find((row) => row.table_name === "competition_bracket_states")!.publication_membership = true;
    expect(() => assertDatabaseAccessMatrixFacts(DATABASE_ACCESS_TABLES, unexpectedPublicationFacts)).toThrow(
      "competition_bracket_states: Realtime publication",
    );

    expect(() => assertDatabaseAccessMatrixFacts(
      [...DATABASE_ACCESS_TABLES, "future_table"],
      expectedFacts(),
    )).toThrow("public table unclassified future_table");

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

  it("removes dead business-table Realtime consumers while retaining Auth-only browser usage", () => {
    for (const path of [
      "src/components/draft/DraftLiveRoom.tsx",
      "src/components/captains/CaptainVotingPanel.tsx",
    ]) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source).not.toMatch(/createBrowserClient|postgres_changes|\.channel\s*\(/);
      expect(source).toContain("10_000");
    }

    const resetPassword = readFileSync(
      join(root, "src/components/auth/ResetPasswordForm.tsx"),
      "utf8",
    );
    expect(resetPassword).toContain("createBrowserClient");
    expect(resetPassword).toMatch(/supabase\.auth\./);
    expect(resetPassword).not.toMatch(/supabase\.from\s*\(/);
  });
});
