import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { confirmStoredDemoParticipantIdentityInTx, retireSeasonGameplaySteamIdentityInTx } from "@/lib/demo-integration/review";
import { revalidateStoredDemoImportInTx } from "@/lib/demo-integration/revalidation";
import { localDatabaseUrl } from "../harness/database";
import { withScratchDatabase, migrationFiles, replayMigration } from "../harness/migration-replay";
import { seedDemoCapacity } from "./demo-fixture";

it("invalidates confirmed Demo ownership across events after a shared identity is retired", async () => {
  await withScratchDatabase("demo_shared_identity", async client => {
    for (const file of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name))) await replayMigration(client, file);
    const url = new URL(localDatabaseUrl()); url.pathname = `/${(await client.query("select current_database() as name")).rows[0].name}`;
    const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6, connectionTimeoutMillis: 2000 });
    try {
      const connection = await pool.connect();
      let first: Awaited<ReturnType<typeof seedDemoCapacity>>; let second: Awaited<ReturnType<typeof seedDemoCapacity>>;
      try {
        first = await seedDemoCapacity(connection, 0);
        second = await seedDemoCapacity(connection, 1, { userIds: first.userIds, steamSeed: 0, alternate: first.alternate });
      } finally { connection.release(); }
      const db = drizzle(pool, { schema });
      expect((await db.transaction(tx => confirmStoredDemoParticipantIdentityInTx(tx, { importId: first.importId, observedSteam64: first.alternate, eventRosterMemberId: first.eventRosterMemberId, actorId: first.actorId }))).status).toBe("confirmed");
      expect((await db.transaction(tx => revalidateStoredDemoImportInTx(tx, { importId: second.importId, actorId: second.actorId }))).status).toBe("confirmed");
      const identity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, first.importId) });
      expect(identity).toMatchObject({ userId: first.userId, status: "active" });
      let release!: () => void; let ready!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<void>(resolve => { ready = resolve; });
      const retirement = db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await retireSeasonGameplaySteamIdentityInTx(tx, { identityId: identity!.id, seasonId: first.seasonId, actorId: first.actorId, reason: "隔离测试撤销" });
        ready(); await gate;
      });
      let revalidation: Promise<unknown> | undefined;
      try {
        await Promise.race([locked, retirement.then(() => { throw new Error("RETIRE_ENDED_BEFORE_BARRIER"); })]);
        revalidation = db.transaction(async tx => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          await tx.execute(sql`set local application_name = 'demo-shared-revalidation'`);
          return revalidateStoredDemoImportInTx(tx, { importId: second.importId, actorId: second.actorId });
        });
        void revalidation.catch(() => undefined);
        let waiting = false; const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const sample = await pool.query("select 1 from pg_stat_activity where application_name = 'demo-shared-revalidation' and wait_event_type = 'Lock'");
          if (sample.rowCount) { waiting = true; break; }
          await delay(10);
        }
        expect(waiting).toBe(true);
        release(); await retirement;
        expect(await revalidation).toMatchObject({ status: "needs_attention" });
      } finally { release(); await retirement.catch(() => undefined); await revalidation?.catch(() => undefined); }
      for (const event of [first, second]) {
        const imported = await db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, event.importId) });
        expect(imported?.status).toBe("needs_attention");
        expect(imported?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: event === first ? "IDENTITY_CHANGED" : "PARTICIPANT_IDENTITY_UNRESOLVED" })]));
      }
      expect((await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.id, identity!.id) }))?.status).toBe("retired");
    } finally { await pool.end(); }
  });
}, 30000);

it("serializes shared identity retirement behind an in-flight revalidation", async () => {
  await withScratchDatabase("demo_shared_reverse", async client => {
    for (const file of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name))) await replayMigration(client, file);
    const url = new URL(localDatabaseUrl()); url.pathname = `/${(await client.query("select current_database() as name")).rows[0].name}`;
    const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6, connectionTimeoutMillis: 2000 });
    try {
      const connection = await pool.connect();
      let first: Awaited<ReturnType<typeof seedDemoCapacity>>; let second: Awaited<ReturnType<typeof seedDemoCapacity>>;
      try {
        first = await seedDemoCapacity(connection, 0);
        second = await seedDemoCapacity(connection, 1, { userIds: first.userIds, steamSeed: 0, alternate: first.alternate });
      } finally { connection.release(); }
      const db = drizzle(pool, { schema });
      await db.transaction(tx => confirmStoredDemoParticipantIdentityInTx(tx, { importId: first.importId, observedSteam64: first.alternate, eventRosterMemberId: first.eventRosterMemberId, actorId: first.actorId }));
      const identity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, first.importId) });
      expect(identity).toMatchObject({ userId: first.userId, status: "active" });
      let release!: () => void; let ready!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<void>(resolve => { ready = resolve; });
      const revalidation = db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        const result = await revalidateStoredDemoImportInTx(tx, { importId: second.importId, actorId: second.actorId });
        ready(); await gate;
        return result;
      });
      let retirement: Promise<unknown> | undefined;
      try {
        await Promise.race([locked, revalidation.then(() => { throw new Error("REVALIDATION_ENDED_BEFORE_BARRIER"); })]);
        retirement = db.transaction(async tx => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          await tx.execute(sql`set local application_name = 'demo-shared-retirement'`);
          return retireSeasonGameplaySteamIdentityInTx(tx, { identityId: identity!.id, seasonId: first.seasonId, actorId: first.actorId, reason: "隔离测试撤销" });
        });
        void retirement.catch(() => undefined);
        let waiting = false; const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const sample = await pool.query("select 1 from pg_stat_activity where application_name = 'demo-shared-retirement' and wait_event_type = 'Lock' and wait_event = 'advisory'");
          if (sample.rowCount) { waiting = true; break; }
          await delay(10);
        }
        expect(waiting).toBe(true);
        release();
        expect(await revalidation).toMatchObject({ status: "confirmed" });
        expect(await retirement).toMatchObject({ retired: true });
      } finally { release(); await revalidation.catch(() => undefined); await retirement?.catch(() => undefined); }
      for (const event of [first, second]) {
        const imported = await db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, event.importId) });
        expect(imported?.status).toBe("needs_attention");
      }
      expect((await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.id, identity!.id) }))?.status).toBe("retired");
      const reconfirmed = await db.transaction(tx => confirmStoredDemoParticipantIdentityInTx(tx, { importId: first.importId, observedSteam64: first.alternate, eventRosterMemberId: first.eventRosterMemberId, actorId: first.actorId }));
      expect(reconfirmed).toMatchObject({ status: "confirmed", aliasCreated: true });
      expect((await db.query.userGameplaySteamIds.findFirst({ where: and(eq(schema.userGameplaySteamIds.steam64, first.alternate), eq(schema.userGameplaySteamIds.status, "active")) }))?.userId).toBe(first.userId);
    } finally { await pool.end(); }
  });
}, 30000);
