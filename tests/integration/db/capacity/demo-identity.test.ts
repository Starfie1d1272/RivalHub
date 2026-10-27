import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { confirmStoredDemoParticipantIdentityInTx, retireSeasonGameplaySteamIdentityInTx } from "@/lib/demo-integration/review";
import { localDatabaseUrl } from "../harness/database";
import { withScratchDatabase, migrationFiles, replayMigration } from "../harness/migration-replay";
import { seedDemoCapacity } from "./demo-fixture";

it("confirms Demo identities across two events while retiring a previous identity", async () => {
  await withScratchDatabase("demo_capacity", async client => {
    for (const file of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name))) await replayMigration(client, file);
    const url = new URL(localDatabaseUrl());
    url.pathname = `/${(await client.query("select current_database() as name")).rows[0].name}`;
    const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6, connectionTimeoutMillis: 2000 });
    try {
      const seedClient = await pool.connect();
      let first: Awaited<ReturnType<typeof seedDemoCapacity>>;
      let second: Awaited<ReturnType<typeof seedDemoCapacity>>;
      try { first = await seedDemoCapacity(seedClient, 0); second = await seedDemoCapacity(seedClient, 1); }
      finally { seedClient.release(); }
      const db = drizzle(pool, { schema });
      const confirmation = (f: typeof first) => ({ importId: f.importId, observedSteam64: f.alternate, eventRosterMemberId: f.eventRosterMemberId, actorId: f.actorId });
      const initial = await db.transaction(tx => confirmStoredDemoParticipantIdentityInTx(tx, confirmation(first)));
      expect(initial.status).toBe("confirmed");
      const identity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, first.importId) });
      expect(identity?.userId).toBe(first.userId);
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const retired = new Promise<void>(resolve => { ready = resolve; });
      const retiring = db.transaction(async tx => {
        await tx.execute("set local statement_timeout = '5s'");
        await tx.execute("set local lock_timeout = '2s'");
        const result = await retireSeasonGameplaySteamIdentityInTx(tx, { identityId: identity!.id, seasonId: first.seasonId, actorId: first.actorId, reason: "隔离测试撤销" });
        ready(); await gate; return result;
      });
      let confirming: Promise<unknown> | undefined;
      try {
        await Promise.race([retired, retiring.then(() => { throw new Error("RETIRE_ENDED_BEFORE_BARRIER"); })]);
        confirming = db.transaction(async tx => {
          await tx.execute("set local statement_timeout = '5s'");
          await tx.execute("set local lock_timeout = '2s'");
          await tx.execute("set local application_name = 'demo-capacity-confirm'");
          return confirmStoredDemoParticipantIdentityInTx(tx, confirmation(second));
        });
        void confirming.catch(() => undefined);
        const deadline = Date.now() + 1500;
        let observed = false;
        while (Date.now() < deadline) {
          const activity = await pool.query("select 1 from pg_stat_activity where application_name = 'demo-capacity-confirm' and wait_event = 'advisory'");
          if (activity.rowCount) { observed = true; break; }
          await delay(10);
        }
        expect(observed).toBe(true);
        release();
        expect(await retiring).toMatchObject({ retired: true });
        expect(await confirming).toMatchObject({ status: "confirmed" });
      } finally {
        release();
        await retiring.catch(() => undefined);
        await confirming?.catch(() => undefined);
      }
      expect((await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.id, identity!.id) }))?.status).toBe("retired");
      const secondIdentity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, second.importId) });
      expect(secondIdentity).toMatchObject({ userId: second.userId, status: "active" });
      expect((await db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, second.importId) }))?.status).toBe("confirmed");
    } finally { await pool.end(); }
  });
}, 30000);

// Each round has a new scratch database and a fixed 17-event fixture. No failed
// mutation is retried; the post-round reads are observations, not replay.
it.skipIf(process.env.RIVALHUB_DEMO_CAPACITY !== "1")("measures cross-event Demo confirmation and identity retirement", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(process.env.RIVALHUB_CAPACITY_SHA ?? "") || sha !== process.env.RIVALHUB_CAPACITY_SHA) throw new Error("EXACT_SHA_REQUIRED");
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "drizzle", "tests/integration/db/capacity/demo-identity.test.ts", "tests/integration/db/capacity/demo-fixture.ts"]);
  const paths = ["tests/integration/db/capacity/demo-identity.test.ts", "tests/integration/db/capacity/demo-fixture.ts", "src/lib/demo-integration/review.ts", "src/lib/identity/write-lock.ts"];
  const report: { sha: string; hashes: Record<string, string>; dataset: string; limits: object; rounds: object[]; stopped?: string; cleanup?: boolean } = {
    sha, hashes: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
    dataset: "fresh scratch database per round; 17 events, 10 players per event, one Demo each; first identity preconfirmed; gradient counts concurrent confirmations plus one retirement",
    limits: { poolMax: 6, acquisitionTimeoutMs: 2000, statementTimeoutMs: 5000, lockTimeoutMs: 2000, sampledQueueStop: 8, stopOnAnyFailure: true }, rounds: [],
  };
  let stop = false;
  try {
    for (const concurrency of [1, 2, 4, 8, 16]) {
      for (let round = 1; round <= 3 && !stop; round++) {
        await withScratchDatabase("demo_capacity_load", async client => {
          for (const file of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name))) await replayMigration(client, file);
          const url = new URL(localDatabaseUrl()); url.pathname = `/${(await client.query("select current_database() as name")).rows[0].name}`;
          const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 6, connectionTimeoutMillis: 2000 });
          const monitor = new Pool({ connectionString: url.toString(), ssl: false, max: 1, connectionTimeoutMillis: 2000 });
          try {
            const connection = await pool.connect();
            const events: Array<Awaited<ReturnType<typeof seedDemoCapacity>>> = [];
            try { for (let seed = 0; seed < 17; seed++) events.push(await seedDemoCapacity(connection, seed)); }
            finally { connection.release(); }
            const db = drizzle(pool, { schema });
            const source = events[0]!;
            const input = (f: typeof source) => ({ importId: f.importId, observedSteam64: f.alternate, eventRosterMemberId: f.eventRosterMemberId, actorId: f.actorId });
            expect((await db.transaction(tx => confirmStoredDemoParticipantIdentityInTx(tx, input(source)))).status).toBe("confirmed");
            const identity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, source.importId) });
            expect(identity?.userId).toBe(source.userId);
            const actors = events.slice(1, concurrency + 1);
            let maxQueue = 0;
            let maxAdvisoryWaiters = 0;
            let sampleError = false;
            let sampling: Promise<void> | undefined;
            const sampler = setInterval(() => {
              maxQueue = Math.max(maxQueue, pool.waitingCount);
              if (!sampling) sampling = monitor.query("select count(*)::int as count from pg_stat_activity where datname = current_database() and application_name = 'demo-capacity-load' and wait_event = 'advisory'")
                .then(result => { maxAdvisoryWaiters = Math.max(maxAdvisoryWaiters, Number(result.rows[0]?.count)); })
                .catch(() => { sampleError = true; })
                .finally(() => { sampling = undefined; });
            }, 20);
            const start = performance.now();
            let elapsedMs = 0;
            const requests = [source, ...actors].map((event, index) => ({ event, index, totalMs: 0, acquireAndBeginMs: null as number | null, transactionMs: null as number | null, error: null as string | null, settings: null as { statement: string; lock: string } | null }));
            try {
              await Promise.all(requests.map(async request => {
                const at = performance.now(); let began: number | undefined;
                try {
                  await db.transaction(async tx => {
                    began = performance.now(); request.acquireAndBeginMs = began - at;
                    const result = await tx.execute("select set_config('statement_timeout','5s',true) as statement, set_config('lock_timeout','2s',true) as lock, set_config('application_name','demo-capacity-load',true) as application");
                    request.settings = result.rows[0] as { statement: string; lock: string };
                    if (request.settings.statement !== "5s" || request.settings.lock !== "2s") throw new Error("TIMEOUT_CONFIGURATION_MISMATCH");
                    if (request.index === 0) await retireSeasonGameplaySteamIdentityInTx(tx, { identityId: identity!.id, seasonId: source.seasonId, actorId: source.actorId, reason: "隔离容量实验" });
                    else await confirmStoredDemoParticipantIdentityInTx(tx, input(request.event));
                  });
                } catch (error) {
                  const item = error as { code?: string; message?: string; cause?: { code?: string } };
                  const code = item?.code ?? item?.cause?.code;
                  request.error = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? `sqlstate_${code}` : /timeout exceeded when trying to connect/i.test(item?.message ?? "") ? "pool_acquisition_timeout" : "unknown";
                } finally {
                  const end = performance.now(); request.totalMs = end - at;
                  if (began !== undefined) request.transactionMs = end - began;
                }
              }));
              elapsedMs = performance.now() - start;
            } finally { clearInterval(sampler); await sampling; }
            const observed = await Promise.all(requests.map(async request => {
              if (request.index === 0) {
                const retiredIdentity = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.id, identity!.id) });
                const imported = await db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, source.importId) });
                return retiredIdentity?.status === "retired" && retiredIdentity.userId === source.userId && imported?.status === "needs_attention";
              }
              const row = await db.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.sourceImportId, request.event.importId) });
              const imported = await db.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, request.event.importId) });
              return row?.status === "active" && row.userId === request.event.userId && imported?.status === "confirmed";
            }));
            expect(requests.some((request, index) => !request.error && !observed[index])).toBe(false);
            stop = requests.some(request => request.error) || maxQueue >= 8 || sampleError;
            if (stop) report.stopped = requests.some(request => request.error) ? "request_failure" : sampleError ? "sampling_failure" : "sampled_pool_queue";
            report.rounds.push({ confirmConcurrency: concurrency, totalRequests: concurrency + 1, round, elapsedMs, maxPoolQueueSampled: maxQueue, maxAdvisoryWaitersSampled: maxAdvisoryWaiters, sampleError,
              outcomes: requests.map((request, index) => ({ index: request.index, totalMs: request.totalMs, acquireAndBeginMs: request.acquireAndBeginMs, transactionMs: request.transactionMs, error: request.error, settings: request.settings, observedCommitted: observed[index], outcome: observed[index] ? "committed" : request.error ? "unresolved" : "missing" })) });
          } finally { await monitor.end(); await pool.end(); }
        });
      }
      if (stop) break;
    }
    report.cleanup = true;
  } finally {
    if (process.env.RIVALHUB_DEMO_CAPACITY_REPORT) writeFileSync(process.env.RIVALHUB_DEMO_CAPACITY_REPORT, JSON.stringify(report, null, 2));
  }
}, 300_000);
