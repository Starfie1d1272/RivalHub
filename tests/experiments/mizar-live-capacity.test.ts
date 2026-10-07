import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { api, state, measured, pool, monitor, publications, prepared, upload, summary, reports, baseline } from "../integration/db/harness/live-capacity";
const { db, schema } = api;

describe("LIVE capacity: explicit multi-source measurements", () => {
for (const scenario of [
    "fast",
    "slow",
    "timeout",
    "disconnect",
    "429",
    "stalled-body",
    "invalid-body",
    "burst",
    "sixteen-fast",
    "sixteen-slow",
  ] as const) {
    it(`measures ${scenario} with multiple matches at up to 2 Hz (burst explicitly abusive)`, async () => {
      const matchCount = scenario.startsWith("sixteen") ? 16 : 4;
      const fixtures = await Promise.all(
        Array.from({ length: matchCount }, () => prepared()),
      );
      state.mode =
        scenario === "burst" || scenario === "sixteen-slow"
          ? "slow"
          : scenario === "sixteen-fast"
            ? "fast"
            : scenario;
      state.sent = 0;
      state.bytes = 0;
      state.maxHttp = 0;
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
      const tasks: Promise<{ matchId: string; at: number; accepted?: boolean; status: number }>[] = [];
      const publicationStart = publications.length;
      const began = performance.now();
      try {
        const count = scenario === "burst" ? 24 : scenario === "sixteen-slow" ? 32 : 20;
        for (let tick = 0; tick < count; tick++) {
          for (const f of fixtures)
            tasks.push(
              (async () => {
                const start = performance.now();
                const res = await upload(f, tick + 1);
                elapsed.push(performance.now() - start);
                const body = await res.json();
                return { matchId: f.matchId, at: performance.now() - began, accepted: body.accepted, status: res.status };
              })(),
            );
          if (scenario !== "burst" && tick < count - 1) await delay(500);
        }
        const results = await Promise.all(tasks);
        const ended = performance.now() - began;
        const perMatch = fixtures.map(f => {
          const rows = results.filter(row => row.matchId === f.matchId);
          const acceptedAt = rows.filter(row => row.accepted).map(row => row.at).sort((a, b) => a - b);
          const attempts = publications.slice(publicationStart).filter(row => row.payload.matchId === f.matchId).map(row => row.at - began);
          const attemptEdges = [0, ...attempts, ended];
          const edges = [0, ...acceptedAt, ended];
          return { providerAttempts: attempts.length,
            maxAdmissionGapMs: Math.max(...attemptEdges.slice(1).map((at, i) => at - attemptEdges[i]!)), matchId: f.matchId, source: f.installationId, accepted: acceptedAt.length,
            maxStarvationMs: Math.max(...edges.slice(1).map((at, i) => at - edges[i]!)),
            recovered: false };
        });
        const report = {
          scenario,
          perMatch,
          matches: matchCount,
          inputs: results.length,
          accepted: results.filter((x) => x.accepted).length,
          dropped: results.filter((x) => x.accepted === false && x.status < 400)
            .length,
          rejected: results.filter((x) => x.status === 429).length,
          failed: results.filter((x) => x.status >= 400 && x.status !== 429)
            .length,
          httpRequests: state.sent,
          bytes: state.bytes,
          maxHttp: state.maxHttp,
          maxPoolQueue: maxQueue,
          maxRelationShareLocks: maxLocks,
          maxWaitingLocks,
          transactionMs: summary(measured.transactions),
          requestMs: summary(elapsed),
          poolWaitMs: summary(poolWait),
          sampledTransactionAgeMs: summary(txAge),
          sampledLockHoldingAgeMs: summary(lockAge),
        };
        // Recovery uses new frames, the same source cadence, no resend of rejected frames.
        state.mode = "fast";
        for (let tick = 0; tick < matchCount + 4; tick++) {
          await Promise.all(fixtures.map(async (f, i) => {
            const result = await upload(f, count + tick + 1);
            if ((await result.json()).accepted) perMatch[i]!.recovered = true;
          }));
          if (perMatch.every(row => row.recovered)) break;
          await delay(500);
        }
        expect(perMatch.every(row => row.recovered)).toBe(true);
        if (scenario !== "burst") expect(perMatch.every(row => row.providerAttempts > 0)).toBe(true);
        if (["fast", "slow", "sixteen-fast", "sixteen-slow"].includes(scenario)) {
          expect(perMatch.every(row => row.accepted > 0)).toBe(true);
          expect(perMatch.every(row => row.maxStarvationMs < (matchCount + 4) * 500)).toBe(true);
        }
        reports.push(report);
        console.log("LIVE_CAPACITY", JSON.stringify(report));
        expect(results).toHaveLength(count * matchCount);
        expect(state.sent).toBeGreaterThan(0);
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

it("keeps four synchronous matches from the same installation moving", async () => {
    const first = await prepared();
    const fixtures = [first];
    for (let i = 1; i < 4; i++) {
      const matchId = randomUUID();
      await db.insert(schema.matches).values({ id: matchId, seasonId: first.seasonId, entryAId: first.entryAId, entryBId: first.entryBId, stage: "shared-installation", format: "bo3", status: "in_progress" });
      const [source] = await db.insert(schema.matchLiveSessions).values({ matchId, installationId: first.installationId, producerInstanceId: first.producerInstanceId, liveSessionId: first.liveSessionId, contextRevision: first.contextRevision, authorityRevision: 1, programSourceGeneration: 0, mapEpoch: 1, identityHealth: "healthy", lineupHealth: "healthy", continuityHealth: "healthy" }).returning({ id: schema.matchLiveSessions.id });
      fixtures.push({ ...first, matchId, sessionId: source!.id });
    }
    state.mode = "fast";
    const accepted = [0, 0, 0, 0], last = [0, 0, 0, 0], gaps = [0, 0, 0, 0];
    const began = performance.now();
    for (let tick = 0; tick < 20; tick++) {
      await Promise.all(fixtures.map(async (f, i) => {
        const result = await upload(f, tick + 1);
        if ((await result.json()).accepted) {
          const at = performance.now() - began;
          accepted[i]!++; gaps[i] = Math.max(gaps[i]!, at - last[i]!); last[i] = at;
        }
      }));
      if (tick < 19) await delay(Math.max(0, began + (tick + 1) * 500 - performance.now()));
    }
    const ended = performance.now() - began;
    const perMatch = fixtures.map((f, i) => ({ matchId: f.matchId, source: f.installationId, accepted: accepted[i], maxStarvationMs: Math.max(gaps[i]!, ended - last[i]!) }));
    reports.push({ scenario: "shared-installation", perMatch });
    expect(accepted.every(count => count >= 8)).toBe(true);
    expect(perMatch.every(row => row.maxStarvationMs < 3000)).toBe(true);
  });

it("prevents a single-source burst from monopolizing three healthy matches", async () => {
    const fixtures = await Promise.all(Array.from({ length: 4 }, () => prepared()));
    const accepted = [0, 0, 0, 0], last = [0, 0, 0, 0], gaps = [0, 0, 0, 0];
    const began = performance.now();
    state.mode = "fast";
    for (let tick = 0; tick < 8; tick++) {
      await Promise.all(fixtures.flatMap((f, i) => Array.from({ length: i === 0 ? 24 : 1 }, async (_, burst) => {
        const response = await upload(f, tick * 24 + burst + 1);
        if ((await response.json()).accepted) {
          const at = performance.now() - began;
          accepted[i]!++; gaps[i] = Math.max(gaps[i]!, at - last[i]!); last[i] = at;
        }
      })));
      if (tick < 7) await delay(500);
    }
    const ended = performance.now() - began;
    const perMatch = fixtures.map((f, i) => ({ matchId: f.matchId, accepted: accepted[i], maxStarvationMs: Math.max(gaps[i]!, ended - last[i]!) }));
    reports.push({ scenario: "single-source-burst", perMatch });
    expect(accepted.every(count => count > 0)).toBe(true);
    expect(perMatch.every(row => row.maxStarvationMs < 3000)).toBe(true);
  });
});
