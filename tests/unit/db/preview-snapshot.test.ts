import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExpectedMigrations } from "../../../scripts/db/production-preflight";
import { PREVIEW_COLUMNS } from "../../../scripts/db/preview/policy";
import { readSnapshot } from "../../../scripts/db/preview/snapshot";

const BASE_MEMBERSHIP = {
  id: "00000000-0000-4000-8000-000000000001",
  team_id: "00000000-0000-4000-8000-000000000002",
  user_id: "00000000-0000-4000-8000-000000000003",
  started_at: "2026-01-01T00:00:00.000Z",
  invited_by_user_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function writeSnapshot(memberships: Record<string, unknown>[]): string {
  const directory = mkdtempSync(join(tmpdir(), "rivalhub-preview-snapshot-"));
  const path = join(directory, "mirror.json");
  const tables = Object.fromEntries(Object.keys(PREVIEW_COLUMNS).map((table) => [table, [] as Record<string, unknown>[]]));
  tables.team_memberships = memberships;
  writeFileSync(path, JSON.stringify({
    format: 2,
    sourceCommit: "a".repeat(40),
    sourceTag: "v2.9.0",
    refreshedAt: "2026-09-12T00:00:00.000Z",
    migrations: readExpectedMigrations(),
    personaCandidates: {},
    assets: [],
    tables,
  }));
  return path;
}

function withSnapshot(memberships: Record<string, unknown>[], work: (path: string) => void): void {
  const path = writeSnapshot(memberships);
  const directory = dirname(path);
  try {
    work(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("preview mirror snapshot membership privacy", () => {
  it("accepts active and ended memberships with the fixed placeholder", () => {
    withSnapshot([
      { ...BASE_MEMBERSHIP, status: "active", ended_at: null, ended_reason: null },
      { ...BASE_MEMBERSHIP, id: "00000000-0000-4000-8000-000000000004", status: "left", ended_at: "2026-02-01T00:00:00.000Z", ended_reason: "left" },
    ], (path) => {
      const snapshot = readSnapshot(path);
      expect(snapshot.tables.team_memberships.map((row) => ({ status: row.status, ended_at: row.ended_at, ended_reason: row.ended_reason }))).toEqual([
        { status: "active", ended_at: null, ended_reason: null },
        { status: "left", ended_at: "2026-02-01T00:00:00.000Z", ended_reason: "left" },
      ]);
    });
  });

  it.each(["kicked", "disbanded"]) ("rejects the real %s end reason", (endedReason) => {
    withSnapshot([
      { ...BASE_MEMBERSHIP, status: "left", ended_at: "2026-02-01T00:00:00.000Z", ended_reason: endedReason },
    ], (path) => {
      expect(() => readSnapshot(path)).toThrow(/Preview mirror membership row failed sanitization/);
    });
  });
});


describe("preview qualification audit privacy", () => {
  const cases = [
    ["match_veto_appeals", { reason: "预览已脱敏" }],
    ["post_event_adjudications", { reason: "预览已脱敏" }],
    ["competition_qualification_drafts", { updated_by: "preview:redacted" }],
    ["competition_qualification_runs", { configured_by: "preview:redacted", started_at: null, started_by: null }],
    ["competition_qualification_runs", { configured_by: "preview:redacted", started_at: "2026-01-01T00:00:00Z", started_by: "preview:redacted" }],
  ] as const;

  it.each(cases)("accepts sanitized %s audit shape", (table, row) => {
    withSnapshot([], (path) => {
      const snapshot = JSON.parse(readFileSync(path, "utf8"));
      snapshot.tables[table] = [row];
      writeFileSync(path, JSON.stringify(snapshot));
      expect(readSnapshot(path).tables[table]).toEqual([row]);
    });
  });

  it.each([
    ["match_veto_appeals", {}],
    ["match_veto_appeals", { reason: "private appeal" }],
    ["post_event_adjudications", { reason: "private reason" }],
    ["competition_qualification_drafts", {}],
    ["competition_qualification_drafts", { updated_by: null }],
    ["competition_qualification_drafts", { updated_by: "private-admin-id" }],
    ["competition_qualification_runs", { configured_by: "private-admin-id", started_at: null, started_by: null }],
    ["competition_qualification_runs", { configured_by: "preview:redacted", started_at: null, started_by: "preview:redacted" }],
    ["competition_qualification_runs", { configured_by: "preview:redacted", started_at: "2026-01-01T00:00:00Z", started_by: null }],
    ["competition_qualification_runs", { configured_by: "preview:redacted", started_at: "2026-01-01T00:00:00Z", started_by: "private-admin-id" }],
    ["competition_qualification_runs", { configured_by: "preview:redacted", started_by: "preview:redacted" }],
  ])("rejects missing, private or inconsistent %s actors before reset", (table, row) => {
    withSnapshot([], (path) => {
      const snapshot = JSON.parse(readFileSync(path, "utf8"));
      snapshot.tables[table as string] = [row];
      writeFileSync(path, JSON.stringify(snapshot));
      expect(() => readSnapshot(path)).toThrow(/required field failed sanitization/);
    });
  });
});
