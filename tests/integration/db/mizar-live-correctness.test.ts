import { setTimeout as delay } from "node:timers/promises";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { state, pool, monitor, publications, snapshot, prepared, upload, reports, db, schema, POST, ingestMizarLive, ingestMizarReliable, RELIABLE_EVENT_SCHEMA_VERSION, revokeMizarInstallation, claimMizarSource, takeOverCurrentMap, loadMizarMatchDocumentInTx, recordCanonicalMapResultInTx } from "./harness/live-capacity";

describe("LIVE correctness: real PostgreSQL and loopback HTTP faults", () => {
  it.each(["timeout", "429", "stalled-body", "invalid-body"] as const)("releases ingress after %s and accepts a fresh frame", async fault => {
    const f = await prepared();
    await delay(1500);
    state.mode = fault;
    expect(await ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 1), 1)).toEqual({ accepted: false });
    await delay(1000);
    state.mode = "fast";
    expect(await ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 2), 1)).toEqual({ accepted: true });
  });

it("rotates synchronous sources even while credential authentication waits on PostgreSQL", async () => {
    const fixtures = await Promise.all(Array.from({ length: 4 }, () => prepared()));
    await delay(1500); // Prior scenarios have stopped; expire their demand leases.
    const accepted = [0, 0, 0, 0];
    state.mode = "fast";
    for (let tick = 0; tick < 4; tick++) {
      const blocker = await monitor.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE mizar_installations IN ACCESS EXCLUSIVE MODE");
        const batch = fixtures.map(async (f, i) => {
          const response = await upload(f, tick + 1);
          if ((await response.json()).accepted) accepted[i]!++;
        });
        // A database barrier, not an arbitrary sleep: both fair permits must be
        // occupied by the actual credential SELECT before releasing authentication.
        await expect.poll(async () => {
          const result = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%mizar_installations%'");
          return result.rows[0].n;
        }, { timeout: 3000, interval: 5 }).toBe(2);
        await blocker.query("COMMIT");
        await Promise.all(batch);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      if (tick < 3) await delay(500);
    }
    expect(accepted).toEqual([2, 2, 2, 2]);
    reports.push({ scenario: "blocked-authentication", perMatch: fixtures.map((f, i) => ({ matchId: f.matchId, accepted: accepted[i] })) });
  });

it("releases ingress after malicious bodies and rejects expired waiters without publication", async () => {
    const f = await prepared();
    const before = publications.length;
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    let cancelled = 0, readers = 0;
    const stalled = () => new ReadableStream<Uint8Array>({ pull() { if (++readers === 2) reading(); }, cancel() { cancelled++; } });
    const post = (body: BodyInit) => POST(new Request("http://local.test/api/mizar/live", { method: "POST", headers: { authorization: `Bearer ${f.token}`, "x-rivalhub-authority": "1" }, body, duplex: "half" } as RequestInit), { params: Promise.resolve({ operation: "live" }) });
    const slow = Promise.all([post(stalled()), post(stalled())]);
    await started;
    expect((await upload(f, 1)).status).toBe(429);
    expect((await slow).map(response => response.status)).toEqual([400, 400]);
    expect(cancelled).toBe(2);
    expect((await post("{" )).status).toBe(400);
    expect((await post("x".repeat(262145))).status).toBe(400);
    expect(publications.length).toBe(before);
    state.mode = "fast";
    expect((await (await upload(f, 2)).json()).accepted).toBe(true);
  });

it("serves four staggered 2 Hz sources and preserves unchanged 1 Hz heartbeats after disconnect", async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 4 }, () => prepared()),
    );
    // This scenario starts after the previous sources stop. Let their bounded
    // demand leases expire; recovery while other tickets exist is tested above.
    await delay(1500);
    state.mode = "fast";
    const outcomes: boolean[][] = fixtures.map(() => []);
    const start = performance.now();
    const tasks = fixtures.map(async (f, i) => {
      await delay(i * 125);
      for (let tick = 0; tick < 4; tick++) {
        const target = start + i * 125 + tick * 510;
        await delay(Math.max(0, target - performance.now()));
        const result = await upload(f, tick + 1);
        outcomes[i]!.push((await result.json()).accepted === true);
      }
    });
    await Promise.all(tasks);
    expect(outcomes.every(rows => rows.every(Boolean))).toBe(true);
    const f = fixtures[0]!;
    await delay(1000);
    state.mode = "disconnect";
    expect(
      await ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 5), 1),
    ).toEqual({ accepted: false });
    await delay(1000);
    state.mode = "fast";
    expect(
      await ingestMizarLive(f.installationId, f.seasonId, snapshot(f, 5), 1),
    ).toEqual({ accepted: true });
    reports.push({
      scenario: "staggered",
      matches: 4,
      inputs: 16,
      accepted: outcomes.flat().filter(Boolean).length,
      perMatch: fixtures.map((f, i) => ({ matchId: f.matchId, accepted: outcomes[i]!.filter(Boolean).length })),
      heartbeatRecovery: true,
    });
  });

it(
    "drops on cross-connection LIVE contention and held authority rows without creating a backlog",
    async () => {
      const f = await prepared();
      state.mode = "fast";
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

it(
    "does not send requests that waited behind unrelated database work",
    async () => {
      const f = await prepared();
      state.mode = "fast";
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
      if (change === "manual") await db.update(schema.matchLiveSessions).set({ continuityHealth: "stale", autoCanonicalizationArmed: false }).where(eq(schema.matchLiveSessions.id, f.sessionId));
      state.mode = "slow";
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
          await takeOverCurrentMap(f.matchId, f.installationId, { sessionId: f.sessionId, mapEpoch: 1, mapId: f.mapOneId });
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
