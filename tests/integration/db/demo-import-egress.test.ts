import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";

const observation = vi.hoisted(() => ({ userId: "", queries: [] as { sql: string; params: unknown[] }[] }));

// Observe actual PostgreSQL queries, including transactions, without replacing
// any query/lineage behavior with mocks.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  return {
    ...actual,
    db: drizzle((actual.db as typeof actual.db & { $client: Pool }).$client, {
      schema,
      logger: { logQuery: (sql, params) => observation.queries.push({ sql, params }) },
    }),
  };
});
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: vi.fn(async () => ({ userId: observation.userId })) }));
vi.mock("@/lib/admin/matches/demo-review", () => ({
  loadAdminDemoReview: vi.fn(async (_tx: unknown, row: { id: string }) => ({ importId: row.id })),
}));

import { db } from "@/db/client";
import { loadAdminMatchOverview } from "@/lib/admin/matches/overview";
import { loadAdminMatchWorkbench } from "@/lib/admin/matches/workbench";
import { readRivalHubEvents } from "@/lib/demo-integration/read";
import { resolveDemoImportLineageInTx } from "@/lib/demo-integration/promotion";
import { revalidateNeedsAttentionImportsForSteam64, revalidateSeasonNeedsAttentionImports } from "@/lib/demo-integration/revalidation";
import { sha256Json } from "@/lib/demo-integration/revision";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";

function importReads() {
  return observation.queries.filter(({ sql }) => /^select\b/i.test(sql) && /from "match_demo_imports"/i.test(sql));
}

function payloadReads() {
  return importReads().filter(({ sql }) => /"payload"/.test(sql.split(/\sfrom\s/i)[0]!));
}

describe("Demo metadata PostgreSQL egress boundary", () => {
  it("keeps catalog, counts and lineage payload-free and reads only selected review/recheck artifacts", async () => {
    const pool = createLocalPool();
    const ids = {
      user: randomUUID(), season: randomUUID(), match: randomUUID(),
      pairingIntent: randomUUID(), pairing: randomUUID(),
      entries: [randomUUID(), randomUUID()], revisions: [randomUUID(), randomUUID()],
      maps: Array.from({ length: 5 }, () => randomUUID()),
    };
    observation.userId = ids.user;
    const slug = `demo-egress-${ids.season}`;
    const fixture = parseRivalHubDemoEvidenceV1(JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json"), "utf8")));
    const steam64 = fixture.participants[0]!.steamId64;
    const unrelated = parseRivalHubDemoEvidenceV1(JSON.parse(JSON.stringify(fixture).replaceAll(steam64, "76561198999999999")));
    const demoHash = "a".repeat(64);
    async function addImport(mapIndex: number, status: string, payload: unknown, order: number, semanticProfile = "dak-stable/3") {
      const id = randomUUID();
      await pool.query(`INSERT INTO match_demo_imports (
        id, season_id, match_id, match_map_id, stage_key, demo_sha256, payload_sha256,
        contract_version, semantic_profile, analysis_version, evidence_revision, status, payload,
        submitted_by_pairing_id, created_at
      ) VALUES ($1, $2, $3, $4, 'fixture-stage', $5, $6, 'rivalhub-demo-evidence/1', $7, $8, $9, $10, $11::jsonb, $12, $13)`, [
        id, ids.season, ids.match, ids.maps[mapIndex], demoHash, sha256Json(payload), semanticProfile,
        fixture.contract.analysisVersion, fixture.target.evidenceRevision, status, JSON.stringify(payload), ids.pairing,
        new Date(Date.UTC(2026, 8, 1, 0, 0, order)),
      ]);
      return id;
    }

    try {
      await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [ids.user, `${ids.user}@local.test`]);
      await pool.query("INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, $2, 'Egress test', 'Custom', 'playing')", [ids.season, slug]);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET CONSTRAINTS ALL DEFERRED");
        for (let i = 0; i < ids.entries.length; i++) {
          await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id)
            VALUES ($1, $2, 'event_native', $3, $4, $5)`, [ids.entries[i], ids.season, `Entry ${i}`, ids.user, ids.revisions[i]]);
          await client.query(`INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by)
            VALUES ($1, $2, 1, 'draft', 'demo-egress-test')`, [ids.revisions[i], ids.entries[i]]);
          await client.query(`INSERT INTO competition_entry_representative_changes (entry_id, to_user_id, changed_by_actor_id)
            VALUES ($1, $2, 'demo-egress-test')`, [ids.entries[i], ids.user]);
        }
        await client.query("COMMIT");
      } finally { client.release(); }
      await pool.query(`INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format)
        VALUES ($1, $2, $3, $4, 'fixture-stage', 'bo5')`, [ids.match, ids.season, ...ids.entries]);
      for (const [index, id] of ids.maps.entries()) {
        await pool.query("INSERT INTO match_maps (id, match_id, map_order, map_name) VALUES ($1, $2, $3, $4)", [id, ids.match, index + 1, ["de_ancient", "de_inferno", "de_mirage", "de_nuke", "de_anubis"][index]]);
      }
      await pool.query("INSERT INTO dak_pairing_intents (id, poll_token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [ids.pairingIntent, randomUUID()]);
      await pool.query(`INSERT INTO dak_pairings (id, pairing_intent_id, user_id, token_hash, scopes, season_ids)
        VALUES ($1, $2, $3, $4, ARRAY['event:read'], ARRAY[$5])`, [ids.pairing, ids.pairingIntent, ids.user, randomUUID(), ids.season]);

      // Historical payloads are deliberately large and must never be returned
      // for a status-only read, even if the displayed current row is rejected.
      await addImport(0, "needs_attention", { ignored: "x".repeat(1024 * 1024) }, 1);
      const confirmed = await addImport(0, "confirmed", { ignored: "y".repeat(1024 * 1024) }, 2);
      await addImport(1, "needs_attention", { ignored: "z".repeat(1024 * 1024) }, 1);
      const rejected = await addImport(1, "rejected", { rejected: true }, 2);
      const related = await addImport(2, "needs_attention", fixture, 1);
      await addImport(2, "superseded", { newer: "superseded" }, 3);
      await addImport(2, "needs_attention", { newer: "legacy" }, 4, "dak-stable/2");
      const other = await addImport(3, "needs_attention", unrelated, 1);
      const invalid = await addImport(4, "needs_attention", { participants: [{ steamId64: steam64 }] }, 1);

      observation.queries.length = 0;
      const events = await readRivalHubEvents({ seasonIds: [ids.season] });
      expect(events.events[0]?.series[0]?.maps.find((map) => map.id === ids.maps[0])?.importId).toBe(confirmed);
      expect(importReads()).toHaveLength(1);
      expect(payloadReads()).toHaveLength(0);

      observation.queries.length = 0;
      const overview = await loadAdminMatchOverview({ seasonSlug: slug });
      expect(overview?.matches[0]?.demoNeedsAttentionCount).toBe(3);
      expect(importReads()).toHaveLength(1);
      expect(payloadReads()).toHaveLength(0);

      observation.queries.length = 0;
      const workbench = await loadAdminMatchWorkbench({ seasonSlug: slug, matchId: ids.match });
      expect(workbench?.demoReviews?.map((row) => row.importId).sort()).toEqual([related, other, invalid].sort());
      expect(payloadReads()).toHaveLength(1);
      expect(payloadReads()[0]?.params).toEqual([related, other, invalid]);

      observation.queries.length = 0;
      const lineage = await db.transaction((tx) => resolveDemoImportLineageInTx(tx, {
        matchMapId: ids.maps[0]!, demoSha256: demoHash, payloadSha256: "0".repeat(64),
      }));
      expect(lineage.sameDemoPredecessor?.id).toBe(confirmed);
      expect(lineage.sameDemoPredecessor).not.toHaveProperty("payload");
      expect(importReads()[0]?.sql).toMatch(/for update$/i);
      expect(payloadReads()).toHaveLength(0);

      observation.queries.length = 0;
      const fanout = await revalidateNeedsAttentionImportsForSteam64({ seasonId: ids.season, steam64, actorId: ids.user });
      expect(fanout).toMatchObject({ attempted: 1, remaining: 1, confirmed: 0, failed: 0 });
      expect(payloadReads()).toHaveLength(2);
      expect(payloadReads().flatMap((query) => query.params).sort()).toEqual([related, invalid].sort());
      expect(importReads().some(({ sql }) => sql.includes(" @> "))).toBe(true);

      observation.queries.length = 0;
      const recheck = await revalidateSeasonNeedsAttentionImports({ seasonId: ids.season, actorId: ids.user });
      expect(recheck).toMatchObject({ attempted: 3, remaining: 3, confirmed: 0, failed: 0 });
      expect(payloadReads()).toHaveLength(3);
      expect(payloadReads().flatMap((query) => query.params).sort()).toEqual([related, other, invalid].sort());
      expect(payloadReads().flatMap((query) => query.params)).not.toContain(rejected);
    } finally {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM audit_logs WHERE season_id = $1", [ids.season]);
        await client.query("DELETE FROM match_demo_imports WHERE season_id = $1", [ids.season]);
        await client.query("DELETE FROM dak_pairings WHERE id = $1", [ids.pairing]);
        await client.query("DELETE FROM dak_pairing_intents WHERE id = $1", [ids.pairingIntent]);
        await client.query("DELETE FROM match_maps WHERE match_id = $1", [ids.match]);
        await client.query("DELETE FROM matches WHERE id = $1", [ids.match]);
        await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [ids.entries]);
        await client.query("DELETE FROM competition_entry_roster_revisions WHERE id = ANY($1::uuid[])", [ids.revisions]);
        await client.query("DELETE FROM competition_entries WHERE competition_id = $1", [ids.season]);
        await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
        await client.query("DELETE FROM users WHERE id = $1", [ids.user]);
        await client.query("COMMIT");
      } finally { client.release(); await pool.end(); }
    }
  });
});
