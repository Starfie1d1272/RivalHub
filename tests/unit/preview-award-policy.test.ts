import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../scripts/db/production-preflight";
import { assertReviewedColumns, exportQuery, previewPolicyFor } from "../../scripts/db/preview/policy";
import { readSnapshot, type MirrorSnapshot } from "../../scripts/db/preview/snapshot";

describe("community award preview boundary", () => {
  it("keeps pre-0090 sources readable and reviews the additive award schema", () => {
    const migrations = readExpectedMigrations();
    const index = migrations.findIndex((migration) => migration.tag === "0090_yellow_blink");
    expect(index).toBeGreaterThan(0);
    const old = previewPolicyFor(migrations.slice(0, index));
    const current = previewPolicyFor(migrations);
    expect(old.tables.community_award_recipients).toBeUndefined();
    expect(() => exportQuery("community_award_recipients", old)).toThrow();
    expect(old.tables.community_awards.exportedColumns).not.toContain("recipient_policy");
    expect(current.tables.community_awards.exportedColumns).toContain("recipient_policy");
    expect(() => assertReviewedColumns("community_award_recipients", ["award_id", "user_id", "position"], current)).not.toThrow();
    expect(() => assertReviewedColumns("community_award_recipients", ["award_id", "user_id", "position", "private_note"], current)).toThrow();
  });

  it("rejects recipient rows outside public awarded outcomes when reading an artifact", () => {
    const migrations = readExpectedMigrations();
    const snapshot: MirrorSnapshot = {
      format: 2, sourceCommit: "a".repeat(40), sourceTag: "v2.20.0",
      refreshedAt: "2026-10-19T00:00:00Z", migrations, assets: [],
      personaCandidates: { currentSeasonId: null, playerUserId: null, invitedUserId: null, captainUserId: null, seasonAdminUserId: null, superAdminUserId: null },
      tables: Object.fromEntries(Object.keys(previewPolicyFor(migrations).tables).map((table) => [table, []])),
    };
    snapshot.tables.community_awards = [{ id: "award", status: "awarded" }];
    snapshot.tables.community_award_recipients = [{ award_id: "award", user_id: "winner", position: 0 }];
    const directory = mkdtempSync(join(tmpdir(), "preview-award-policy-"));
    const path = join(directory, "snapshot.json");
    try {
      const read = () => { writeFileSync(path, JSON.stringify(snapshot)); return readSnapshot(path); };
      expect(read().tables.community_award_recipients).toHaveLength(1);
      snapshot.tables.community_awards[0].status = "pending_review";
      expect(read).toThrow("outside a public awarded outcome");
      snapshot.tables.community_awards = [];
      expect(read).toThrow("outside a public awarded outcome");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
