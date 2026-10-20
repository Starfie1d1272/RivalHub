import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../scripts/db/production-preflight";
import { exportQuery, previewPolicyFor } from "../../scripts/db/preview/policy";
import { readSnapshot, type MirrorSnapshot } from "../../scripts/db/preview/snapshot";

describe("public discipline mirror boundary", () => {
  it("omits private evidence and actors from the export projection", () => {
    const query = exportQuery("disciplinary_cases");
    expect(query).not.toContain("internal_evidence");
    expect(query).not.toContain("revocation_reason");
    expect(query).not.toContain('"issued_by"');
    expect(query).toContain("'preview:redacted'::text AS issued_by");
    expect(query).toContain("status <> 'draft'");
    expect(query).toContain("effective_from <= now()");
    const migrations = readExpectedMigrations();
    const before = migrations.slice(0, migrations.findIndex((migration) => migration.tag === "0010_same_the_order"));
    expect(previewPolicyFor(before).tables.disciplinary_cases).toBeUndefined();
  });

  it("rejects private fields, actors and non-public cases when reading the artifact", () => {
    const migrations = readExpectedMigrations();
    const snapshot: MirrorSnapshot = {
      format: 2, sourceCommit: "a".repeat(40), sourceTag: "v2.20.0",
      refreshedAt: "2026-10-20T00:00:00Z", migrations, assets: [],
      personaCandidates: { currentSeasonId: null, playerUserId: null, invitedUserId: null, captainUserId: null, seasonAdminUserId: null, superAdminUserId: null },
      tables: Object.fromEntries(Object.keys(previewPolicyFor(migrations).tables).map((table) => [table, []])),
    };
    snapshot.tables.seasons = [{ id: "event", status: "finished" }];
    const row: Record<string, unknown> = { id: "case", season_id: "event", status: "active", effective_from: "2026-01-01T00:00:00Z", issued_by: "preview:redacted" };
    snapshot.tables.disciplinary_cases = [row];
    const directory = mkdtempSync(join(tmpdir(), "preview-discipline-"));
    const path = join(directory, "snapshot.json");
    try {
      const read = () => { writeFileSync(path, JSON.stringify(snapshot)); return readSnapshot(path); };
      expect(read().tables.disciplinary_cases).toHaveLength(1);
      row.internal_evidence = "private";
      expect(read).toThrow("Preview mirror snapshot is invalid");
      delete row.internal_evidence;
      row.issued_by = "real-admin";
      expect(read).toThrow("sanitization");
      row.issued_by = "preview:redacted";
      row.status = "draft";
      expect(read).toThrow("outside a public effective outcome");
      row.status = "active";
      row.effective_from = "2027-01-01T00:00:00Z";
      expect(read).toThrow("outside a public effective outcome");
      row.effective_from = "2026-01-01T00:00:00Z";
      snapshot.tables.seasons[0].status = "draft";
      expect(read).toThrow("outside a public effective outcome");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
