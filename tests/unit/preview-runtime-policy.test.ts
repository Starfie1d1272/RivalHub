import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../scripts/db/production-preflight";
import { assertReviewedColumns, exportQuery, previewPolicyFor } from "../../scripts/db/preview/policy";
import { readSnapshot, type MirrorSnapshot } from "../../scripts/db/preview/snapshot";

describe("preview runtime record isolation", () => {
  it.each([
    ["match_veto_invalidations", ["match_id", "generation", "published_generation", "affected_facts", "last_transaction_id", "updated_at"]],
    ["operator_scoreboard_receipts", ["actor_user_id", "operation_id", "map_id", "operation", "payload_digest", "base_version", "result_version", "result_count", "created_at"]],
  ] as const)("recognizes %s in production but rejects export and artifact import", (table, columns) => {
    const migrations = readExpectedMigrations();
    const policy = previewPolicyFor(migrations);
    expect(() => assertReviewedColumns(table, columns, policy)).not.toThrow();
    expect(() => assertReviewedColumns("unreviewed_runtime_records", ["id"], policy)).toThrow();
    expect(() => assertReviewedColumns("matches", [...policy.tables.matches.exportedColumns, "private_unreviewed"], policy)).toThrow();
    expect(() => exportQuery(table, policy)).toThrow("not permitted in mirror export");
    const snapshot: MirrorSnapshot = {
      format: 2, sourceCommit: "a".repeat(40), sourceTag: "v2.23.2",
      refreshedAt: "2026-10-25T00:00:00Z", migrations, assets: [],
      personaCandidates: { currentSeasonId: null, playerUserId: null, invitedUserId: null, captainUserId: null, seasonAdminUserId: null, superAdminUserId: null },
      tables: Object.fromEntries(Object.keys(policy.tables).map((name) => [name, []])),
    };
    const directory = mkdtempSync(join(tmpdir(), "preview-runtime-policy-"));
    const path = join(directory, "snapshot.json");
    try {
      writeFileSync(path, JSON.stringify(snapshot));
      expect(() => readSnapshot(path)).not.toThrow();
      snapshot.tables[table] = [{ [columns[0]]: "production-only" }];
      writeFileSync(path, JSON.stringify(snapshot));
      expect(() => readSnapshot(path)).toThrow(expect.objectContaining({ code: "PREVIEW_SNAPSHOT_INVALID" }));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
