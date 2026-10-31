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
import { failureClass } from "./failure-class";
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

it.skipIf(process.env.RIVALHUB_DEMO_REVERSE_CAPACITY !== "1")("measures shared identity retirements queued behind revalidation", async () => {
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { readFileSync, writeFileSync } = await import("node:fs");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sha !== process.env.RIVALHUB_CAPACITY_SHA || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/demo-fixture.ts", "tests/integration/db/capacity/demo-shared-identity.test.ts", "tests/integration/db/capacity/failure-class.ts"]);
  const paths = ["tests/integration/db/capacity/failure-class.ts", "tests/integration/db/capacity/demo-shared-identity.test.ts", "tests/integration/db/capacity/demo-fixture.ts", "src/lib/demo-integration/review.ts", "src/lib/demo-integration/revalidation.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch per round; two events share one identity; one revalidation holder and repeated retirement requests for that identity",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, heldSqlSleepMs: 200, sampledQueueStop: 8, stopOnUnexpected: true }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await withScratchDatabase("demo_reverse_load", async client => {
          for (const file of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name))) await replayMigration(client, file);
          const url = new URL(localDatabaseUrl()); url.pathname = `/${(await client.query("select current_database() as name")).rows[0].name}`;
          const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6, connectionTimeoutMillis: 2000 });
          const monitor = new Pool({ connectionString: url.toString(), ssl: false, max: 1, connectionTimeoutMillis: 2000 });
          try {
            const connection = await pool.connect();
            let first: Awaited<ReturnType<typeof seedDemoCapacity>>; let second: Awaited<ReturnType<typeof seedDemoCapacity>>;
            try { first = await seedDemoCapacity(connection, 0); second = await seedDemoCapacity(connection, 1, { userIds: first.userIds, steamSeed: 0, alternate: first.alternate }); }
            finally { connection.release(); }
            const db = drizzle(pool, { schema });
            await db.transaction(tx => confirmStoredDemoParticipantIdentityInTx(tx, { importId: first.importId, observedSteam64: first.alternate, eventRosterMemberId: first.eventRosterMemberId, actorId: first.actorId }));
            const identity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, first.importId) });
            expect(identity).toMatchObject({ userId: first.userId, status: "active" });
            let release!: () => void; let ready!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; }); const locked = new Promise<void>(resolve => { ready = resolve; });
            const holder = db.transaction(async tx => {
              await tx.execute(sql`set local lock_timeout = '2s'`); await tx.execute(sql`set local statement_timeout = '5s'`);
              expect((await revalidateStoredDemoImportInTx(tx, { importId: second.importId, actorId: second.actorId })).status).toBe("confirmed");
              ready(); await gate; await tx.execute(sql`select pg_sleep(0.2)`);
            });
            const requests = Array.from({ length: concurrency }, () => ({ totalMs: 0, acquisitionMs: null as number | null, transactionMs: null as number | null, result: "unknown", settings: null as object | null }));
            let tasks: Promise<void>[] = []; let maxQueue = 0; let waiting = 0;
            const sampler = setInterval(() => { maxQueue = Math.max(maxQueue, pool.waitingCount); }, 5);
            try {
              await Promise.race([locked, holder.then(() => { throw new Error("HOLDER_ENDED_BEFORE_BARRIER"); })]);
              const at = performance.now();
              tasks = requests.map(async request => {
                const begin = performance.now(); let acquired: number | undefined;
                try {
                  const result = await db.transaction(async tx => {
                    acquired = performance.now(); request.acquisitionMs = acquired - begin;
                    const settings = await tx.execute(sql`select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock, set_config('application_name','demo-reverse-load',true) as application`);
                    request.settings = settings.rows[0];
                    if (settings.rows[0]?.statement !== "5s" || settings.rows[0]?.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                    return retireSeasonGameplaySteamIdentityInTx(tx, { identityId: identity!.id, seasonId: first.seasonId, actorId: first.actorId, reason: "隔离容量实验" });
                  });
                  request.result = result.retired ? "retired" : "already_retired";
                } catch (error) { request.result = failureClass(error); }
                finally { const end = performance.now(); request.totalMs = end - begin; if (acquired !== undefined) request.transactionMs = end - acquired; }
              });
              const deadline = Date.now() + 1200;
              while (Date.now() < deadline) {
                const sample = await monitor.query("select count(*)::int as count from pg_stat_activity where application_name = 'demo-reverse-load' and wait_event = 'advisory'");
                waiting = sample.rows[0].count;
                if (waiting >= Math.min(concurrency, 5)) break;
                await delay(10);
              }
              release(); await holder; await Promise.all(tasks); const elapsedMs = performance.now() - at;
              const observed = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.id, identity!.id) });
              const imports = await Promise.all([first, second].map(event => db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, event.importId) })));
              const unexpected = waiting < Math.min(concurrency, 5) || requests.filter(r => r.result === "retired").length !== 1 || requests.some(r => !["retired", "already_retired"].includes(r.result)) || observed?.status !== "retired" || observed.userId !== first.userId || imports.some(item => item?.status !== "needs_attention");
              stop = unexpected || maxQueue >= 8;
              if (stop) report.stopped = unexpected ? "unexpected_or_sampling_failure" : "sampled_pool_queue";
              report.rounds.push({ concurrency, round, elapsedMs, requestsPerSecond: concurrency / (elapsedMs / 1000), observedAdvisoryWaiters: waiting, maxPoolQueueSampled: maxQueue, outcomes: requests, identityRetired: observed?.status === "retired", importsInvalidated: imports.every(item => item?.status === "needs_attention"), timingIncludesArtificialBarrier: true });
            } finally { release(); clearInterval(sampler); await holder.catch(() => undefined); await Promise.allSettled(tasks); }
          } finally { await monitor.end(); await pool.end(); }
        });
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally { if (process.env.RIVALHUB_DEMO_REVERSE_REPORT) writeFileSync(process.env.RIVALHUB_DEMO_REVERSE_REPORT, JSON.stringify(report, null, 2)); }
  expect(report.stopped).not.toBe("unexpected_or_sampling_failure");
}, 180000);
