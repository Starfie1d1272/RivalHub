import { createHash } from "node:crypto";
import { cpus, totalmem, platform, arch } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";
import { seedFixture, type Fixture } from "./harness/mizar";

const measured = vi.hoisted(() => ({ transactions: [] as number[] }));

// Real PostgreSQL with production's three-connection pool; only Next cache hooks
// are stubbed. The real SDK sends HTTP to a loopback fault injector.
vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  const { createLocalPool } = await import("./harness/database");
  const realDb = drizzle(
    createLocalPool({ max: 3, connectionTimeoutMillis: 10000 }),
    { schema },
  );
  const transaction = realDb.transaction.bind(realDb);
  realDb.transaction = async (work, config) => {
    let began = 0;
    try {
      return await transaction((tx) => {
        began = performance.now();
        return work(tx);
      }, config);
    } finally {
      if (began) measured.transactions.push(performance.now() - began);
    }
  };
  return { db: realDb };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { POST } from "@/app/api/mizar/[operation]/route";
import {
  hashCredential,
  revokeMizarInstallation,
} from "@/lib/mizar/installation";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";
import { ingestMizarLive } from "@/lib/mizar/live";
import { claimMizarSource, takeOverCurrentMap } from "@/lib/mizar/source";
import { loadMizarMatchDocumentInTx } from "@/lib/mizar/context";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";

const baseline = process.env.LIVE_CAPACITY_BASELINE === "1";
const fixtureWire = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/contracts/mizar-live-snapshot-v1.radar.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const pool = (db as typeof db & { $client: ReturnType<typeof createLocalPool> })
  .$client;
const monitor = createLocalPool({ max: 1 });
let mode: "fast" | "slow" | "timeout" | "disconnect" | "429" | "stalled-body" =
  "fast";
let sent = 0;
let bytes = 0;
let activeHttp = 0;
let maxHttp = 0;
const publications: Array<{ at: number; payload: Record<string, unknown> }> =
  [];
const server = createServer(async (req, res) => {
  const current = mode;
  let body = "";
  for await (const chunk of req) body += chunk.toString();
  sent++;
  bytes += Buffer.byteLength(body);
  activeHttp++;
  maxHttp = Math.max(maxHttp, activeHttp);
  res.on("close", () => {
    activeHttp--;
  });
  expect(req.url).toContain("private=true");
  const payload = JSON.parse(body);
  publications.push({ at: performance.now(), payload });
  if (current === "disconnect") {
    res.destroy();
    return;
  }
  if (current === "stalled-body") {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.write('{"error":"');
    await delay(2600);
    res.end('slow"}');
    return;
  }
  await delay(current === "slow" ? 700 : current === "timeout" ? 2600 : 5);
  res.writeHead(current === "429" ? 429 : 202, {
    "Content-Type": "application/json",
  });
  res.end(current === "429" ? '{"error":"quota"}' : "{}");
});
function snapshot(f: Fixture, seq = 1, producedAt = new Date().toISOString()) {
  return {
    ...fixtureWire,
    matchId: f.matchId,
    competitionId: f.seasonId,
    format: "bo3",
    producedAt,
    capability: { ...fixtureWire.capability, lineupComplete: true },
    cursor: {
      ...fixtureWire.cursor,
      producerInstanceId: f.producerInstanceId,
      liveSessionId: f.liveSessionId,
      programSourceGeneration: 0,
      mapEpoch: 1,
      runtimeSeq: seq,
    },
    players: Array.from({ length: 10 }, (_, i) => ({
      sourcePlayerId: `source-${i}`,
      canonicalPlayerId: `player-${i}`,
      identityEvidence: "canonical",
      lineupEvidence: "current",
      displayName: `测试选手 ${i}`,
      side: i < 5 ? "CT" : "T",
      lifeState: "alive",
      health: 100,
      armor: 100,
      hasHelmet: true,
      hasDefuser: i < 5,
      money: 3500,
      equipmentValue: 5000,
      activeWeapon: { name: "weapon_ak47", ammoClip: 30, ammoReserve: 90 },
      stats: {
        kills: 10,
        assists: 2,
        deaths: 6,
        liveAdr: 82.5,
        completedAdr: 80,
      },
    })),
    radar: {
      ...fixtureWire.radar,
      players: Array.from({ length: 10 }, (_, i) => ({
        ...fixtureWire.radar.players[0],
        sourcePlayerId: `source-${i}`,
        canonicalPlayerId: `player-${i}`,
        side: i < 5 ? "CT" : "T",
      })),
    },
    roundHistory: {
      mapOrder: 1,
      completeness: "complete",
      rounds: Array.from({ length: 24 }, (_, i) => ({
        roundNumber: i + 1,
        winnerSide: i % 2 ? "T" : "CT",
        winnerEntryId: i % 2 ? f.entryBId : f.entryAId,
        winCondition: "elimination",
      })),
    },
    teams: {
      ct: { entryId: f.entryAId, name: "A" },
      t: { entryId: f.entryBId, name: "B" },
    },
  };
}
async function prepared() {
  const f = await seedFixture();
  const token = `rh_mizar_${f.installationId}_${"a".repeat(64)}`;
  await db
    .update(schema.mizarInstallations)
    .set({ credentialHash: hashCredential(token) })
    .where(eq(schema.mizarInstallations.id, f.installationId));
  return { ...f, token };
}
async function upload(f: Awaited<ReturnType<typeof prepared>>, seq: number) {
  return POST(
    new Request("http://local.test/api/mizar/live", {
      method: "POST",
      headers: {
        authorization: `Bearer ${f.token}`,
        "x-rivalhub-authority": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify(snapshot(f, seq)),
    }),
    { params: Promise.resolve({ operation: "live" }) },
  );
}
function summary(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: s[Math.floor(s.length * 0.5)] ?? 0,
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0,
    max: s.at(-1) ?? 0,
  };
}
const reports: unknown[] = [];
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("loopback listener missing");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-fault-injector-key");
});
afterAll(async () => {
  if (process.env.LIVE_CAPACITY_REPORT)
    writeFileSync(
      process.env.LIVE_CAPACITY_REPORT,
      JSON.stringify(
        {
          sha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          baseline,
          node: process.version,
          platform: platform(),
          arch: arch(),
          cpus: cpus().length,
          hostMemoryBytes: totalmem(),
          poolMax: 3,
          sourceSha256: Object.fromEntries(
            [
              "src/lib/mizar/live.ts",
              "src/lib/mizar/http.ts",
              "src/lib/mizar/live-admission.ts",
              "src/lib/mizar/live-broadcast.ts",
              "src/lib/auth/supabase-server.ts",
              "src/app/api/mizar/[operation]/route.ts",
              "tests/integration/db/mizar-live-capacity.test.ts",
              "tests/integration/db/harness/mizar.ts",
            ]
              .filter(existsSync)
              .map((path) => [
                path,
                createHash("sha256").update(readFileSync(path)).digest("hex"),
              ]),
          ),
          reports,
        },
        null,
        2,
      ),
    );
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await monitor.end();
  await pool.end();
});

describe("LIVE capacity: real PostgreSQL and loopback HTTP faults", () => {
  for (const scenario of [
    "fast",
    "slow",
    "timeout",
    "disconnect",
    "429",
    "stalled-body",
    "burst",
    "sixteen-fast",
    "sixteen-slow",
  ] as const) {
    it(`measures ${scenario} with multiple matches at up to 2 Hz (burst explicitly abusive)`, async () => {
      const matchCount = scenario.startsWith("sixteen") ? 16 : 4;
      const fixtures = await Promise.all(
        Array.from({ length: matchCount }, () => prepared()),
      );
      mode =
        scenario === "burst" || scenario === "sixteen-slow"
          ? "slow"
          : scenario === "sixteen-fast"
            ? "fast"
            : scenario;
      sent = 0;
      bytes = 0;
      maxHttp = 0;
      measured.transactions = [];
      const elapsed: number[] = [];
      const poolWait: number[] = [];
      const txAge: number[] = [];
      const lockAge: number[] = [];
      let maxQueue = 0,
        maxLocks = 0,
        maxWaitingLocks = 0;
      const original = pool.connect.bind(pool);
      // Instrument actual acquisition without replacing any SQL or transaction.
      const spy = vi
        .spyOn(pool, "connect")
        .mockImplementation((...args: unknown[]) => {
          const start = performance.now();
          const callback = args[0];
          if (typeof callback === "function")
            return original((...result) => {
              poolWait.push(performance.now() - start);
              callback(...result);
            });
          return original().then((client) => {
            poolWait.push(performance.now() - start);
            return client;
          });
        });
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          maxQueue = Math.max(maxQueue, pool.waitingCount);
          const r =
            await monitor.query(`SELECT COALESCE(max(extract(epoch FROM (clock_timestamp()-xact_start))*1000),0)::float8 age,
            count(*) FILTER (WHERE wait_event_type='Lock')::int waiting FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL`);
          txAge.push(r.rows[0].age);
          maxWaitingLocks = Math.max(maxWaitingLocks, r.rows[0].waiting);
          const l = await monitor.query(
            `SELECT count(*)::int n FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND mode='RowShareLock' AND granted`,
          );
          maxLocks = Math.max(maxLocks, l.rows[0].n);
          if (l.rows[0].n) lockAge.push(r.rows[0].age);
          await delay(20);
        }
      })();
      const tasks: Promise<{ accepted?: boolean; status: number }>[] = [];
      try {
        const count = scenario === "burst" ? 24 : 3;
        for (let tick = 0; tick < count; tick++) {
          for (const f of fixtures)
            tasks.push(
              (async () => {
                const start = performance.now();
                const res = await upload(f, tick + 1);
                elapsed.push(performance.now() - start);
                const body = await res.json();
                return { accepted: body.accepted, status: res.status };
              })(),
            );
          if (scenario !== "burst" && tick < count - 1) await delay(500);
        }
        const results = await Promise.all(tasks);
        const report = {
          scenario,
          matches: matchCount,
          inputs: results.length,
          accepted: results.filter((x) => x.accepted).length,
          dropped: results.filter((x) => x.accepted === false && x.status < 400)
            .length,
          rejected: results.filter((x) => x.status === 429).length,
          failed: results.filter((x) => x.status >= 400 && x.status !== 429)
            .length,
          httpRequests: sent,
          bytes,
          maxHttp,
          maxPoolQueue: maxQueue,
          maxRelationShareLocks: maxLocks,
          maxWaitingLocks,
          transactionMs: summary(measured.transactions),
          requestMs: summary(elapsed),
          poolWaitMs: summary(poolWait),
          sampledTransactionAgeMs: summary(txAge),
          sampledLockHoldingAgeMs: summary(lockAge),
        };
        reports.push(report);
        console.log("LIVE_CAPACITY", JSON.stringify(report));
        expect(results).toHaveLength(count * matchCount);
        expect(sent).toBeGreaterThan(0);
        if (scenario === "fast") expect(report.accepted).toBeGreaterThan(0);
        if (!baseline && scenario === "burst")
          expect(report.maxPoolQueue).toBe(0);
        if (!baseline && scenario === "stalled-body")
          expect(report.requestMs.max).toBeLessThan(2500);
        for (const f of fixtures) {
          const [m] = await db
            .select()
            .from(schema.matches)
            .where(eq(schema.matches.id, f.matchId));
          expect([m!.scoreA, m!.scoreB]).toEqual([null, null]);
        }
      } finally {
        sampling = false;
        await sampler;
        spy.mockRestore();
      }
    });
  }

  it("serves four staggered 2 Hz sources and preserves unchanged 1 Hz heartbeats after disconnect", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 4 }, () => prepared()),
    );
    mode = "fast";
    const outcomes: boolean[] = [];
    const start = performance.now();
    const tasks = fixtures.map(async (f, i) => {
      await delay(i * 125);
      for (let tick = 0; tick < 4; tick++) {
        const target = start + i * 125 + tick * 510;
        await delay(Math.max(0, target - performance.now()));
        const result = await upload(f, tick + 1);
        outcomes.push((await result.json()).accepted === true);
      }
    });
    await Promise.all(tasks);
    expect(outcomes.every(Boolean)).toBe(true);
    const f = fixtures[0]!;
    await delay(1000);
    mode = "disconnect";
    expect(
      await ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 5), 1),
    ).toEqual({ accepted: false });
    await delay(1000);
    mode = "fast";
    expect(
      await ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 5), 1),
    ).toEqual({ accepted: true });
    reports.push({
      scenario: "staggered",
      matches: 4,
      inputs: 16,
      accepted: outcomes.filter(Boolean).length,
      heartbeatRecovery: true,
    });
  });

  it.skipIf(baseline)(
    "drops on cross-connection LIVE contention and held authority rows without creating a backlog",
    async () => {
      const f = await prepared();
      mode = "fast";
      const client = await monitor.connect();
      const before = publications.length;
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`mizar-live:${f.matchId}`],
        );
        expect(
          await ingestMizarLive(f.installationId, f.seasonId, snapshot(f), 1),
        ).toEqual({ accepted: false });
        await client.query("ROLLBACK");
        for (const [table, id] of [
          ["mizar_installations", f.installationId],
          ["matches", f.matchId],
          ["match_live_sessions", f.sessionId],
        ]) {
          await client.query("BEGIN");
          await client.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
            id,
          ]);
          const start = performance.now();
          expect(
            await ingestMizarLive(f.installationId, f.seasonId, snapshot(f), 1),
          ).toEqual({ accepted: false });
          expect(performance.now() - start).toBeLessThan(500);
          await client.query("ROLLBACK");
        }
        expect(publications.length).toBe(before);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );

  it.skipIf(baseline)(
    "does not send requests that waited behind unrelated database work",
    async () => {
      const f = await prepared();
      mode = "fast";
      const before = publications.length;
      const clients = await Promise.all([
        pool.connect(),
        pool.connect(),
        pool.connect(),
      ]);
      const work = upload(f, 1);
      await delay(550);
      for (const client of clients) client.release();
      expect(await (await work).json()).toEqual({ accepted: false });
      expect(publications.length).toBe(before);
    },
  );

  it("holds authority fencing through send while revoke, handover and manual results contend", async () => {
    for (const change of ["revoke", "handover", "manual"] as const) {
      const f = await prepared();
      mode = "slow";
      const before = publications.length;
      const live = ingestMizarLive(
        f.installationId,
        f.seasonId,
        snapshot(f),
        1,
      );
      await vi.waitFor(() =>
        expect(publications.length).toBeGreaterThan(before),
      );
      let committed = false;
      const start = performance.now();
      const mutate = (async () => {
        if (change === "revoke")
          await revokeMizarInstallation(
            f.installationId,
            f.seasonId,
            f.installationId,
          );
        if (change === "handover") {
          const context = await db.transaction((tx) =>
            loadMizarMatchDocumentInTx(tx, f.matchId, f.seasonId),
          );
          await claimMizarSource(f.installationBId, f.seasonId, {
            matchId: f.matchId,
            producerInstanceId: "new",
            liveSessionId: "new",
            programSourceGeneration: 0,
            mapEpoch: 1,
            contextRevision: context.revision,
            takeover: true,
            lineupSteam64: [],
          });
        }
        if (change === "manual") {
          await takeOverCurrentMap(f.matchId, f.installationId);
          await db.transaction((tx) =>
            recordCanonicalMapResultInTx(tx, {
              matchId: f.matchId,
              mapOrder: 1,
              mapName: "de_ancient",
              scoreA: 13,
              scoreB: 9,
              pickedByEntryId: null,
              teamAStartSide: null,
              actorId: f.installationId,
            }),
          );
        }
        committed = true;
      })();
      await delay(80);
      expect(committed).toBe(false);
      const waits = await monitor.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
      );
      expect(waits.rows[0].n).toBeGreaterThan(0);
      await live;
      await mutate;
      reports.push({
        change,
        mutationMs: performance.now() - start,
        observedLockWaiters: waits.rows[0].n,
      });
      if (change !== "manual")
        await expect(
          ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 2), 1),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      else {
        const [m] = await db
          .select()
          .from(schema.matchMaps)
          .where(eq(schema.matchMaps.id, f.mapOneId));
        expect([m!.scoreA, m!.scoreB]).toEqual([13, 9]);
        const [source] = await db
          .select()
          .from(schema.matchLiveSessions)
          .where(
            and(
              eq(schema.matchLiveSessions.matchId, f.matchId),
              isNull(schema.matchLiveSessions.closedAt),
            ),
          );
        expect(source!.autoCanonicalizationArmed).toBe(false);
        await ingestMizarReliable(
          f.installationId,
          f.seasonId,
          {
            schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION,
            idempotencyKey: `late-${f.matchId}`,
            cursor: { ...snapshot(f).cursor, runtimeSeq: 9 },
            observedAt: new Date().toISOString(),
            matchId: f.matchId,
            competitionId: f.seasonId,
            contextRevision: f.contextRevision,
            mapId: f.mapOneId,
            mapName: "de_ancient",
            entryAId: f.entryAId,
            entryBId: f.entryBId,
            evidence: {
              identity: "matched",
              telemetryFresh: true,
              contextFresh: true,
              source: "runtime-transition",
            },
            kind: "map_ended",
            payload: { scoreA: 9, scoreB: 13, scoreCT: 9, scoreT: 13 },
          },
          1,
        );
        const [unchanged] = await db
          .select()
          .from(schema.matchMaps)
          .where(eq(schema.matchMaps.id, f.mapOneId));
        expect([unchanged!.scoreA, unchanged!.scoreB]).toEqual([13, 9]);
      }
    }
  });
});
