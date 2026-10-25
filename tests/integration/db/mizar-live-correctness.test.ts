import { setTimeout as delay } from "node:timers/promises";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { loadPublicMatchRefreshToken } from "@/lib/matches/public-refresh";
import { api, state, pool, monitor, publications, snapshot, prepared, upload, reports } from "./harness/live-capacity";
const { db, schema, hashCredential, POST, ingestMizarLive, ingestMizarReliable, RELIABLE_EVENT_SCHEMA_VERSION, revokeMizarInstallation, claimMizarSource, takeOverCurrentMap, loadMizarMatchDocumentInTx, recordCanonicalMapResultInTx } = api;

describe("LIVE correctness: real PostgreSQL and loopback HTTP faults", () => {
  it("keeps a public read and reliable map completion available while both LIVE sends hold permits", async () => {
    const fixtures = await Promise.all(Array.from({ length: 3 }, () => prepared()));
    await delay(1500);
    const before = publications.length;
    let release!: () => void;
    state.sendBarrier = new Promise<void>(resolve => { release = resolve; });
    const live = fixtures.slice(0, 2).map(f => upload(f, 1));
    try {
      await vi.waitFor(() => expect(publications.length).toBe(before + 2));
      const f = fixtures[2]!;
      const start = performance.now();
      const [token, receipt] = await Promise.all([
        loadPublicMatchRefreshToken(f.seasonId, { matchId: f.matchId }),
        ingestMizarReliable(f.installationId, f.seasonId, {
          schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION, idempotencyKey: "mixed-map-end",
          cursor: { producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 },
          observedAt: new Date().toISOString(), matchId: f.matchId, competitionId: f.seasonId, contextRevision: f.contextRevision,
          mapId: f.mapOneId, mapName: "de_ancient", entryAId: f.entryAId, entryBId: f.entryBId,
          evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
          kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 },
        }, f.authorityRevision),
      ]);
      const nonLiveMs = performance.now() - start;
      expect(token).toMatch(/^[a-f0-9]{32}$/);
      expect(receipt).toEqual({ outcome: "canonicalized", duplicate: false });
      expect(nonLiveMs).toBeLessThan(1500);
      reports.push({ scenario: "two-live-public-read-reliable-completion", livePermits: 2, poolMax: 3, nonLiveMs, receipt, publicRead: true });
    } finally {
      release(); state.sendBarrier = undefined;
      expect(await Promise.all(live.map(async result => (await (await result).json()).accepted))).toEqual([true, true]);
    }
  });

  it.each([false, true])("accepts fresh LIVE at 95ms SQL RTT with observed lineup=%s", async observedLineup => {
    const f = await prepared();
    await delay(1500);
    state.mode = "fast";
    const input = snapshot(f, 1);
    if (observedLineup) {
      await db.update(schema.matchLiveSessions).set({ lineupHealth: "review_required", autoCanonicalizationArmed: false,
        identityHealth: "healthy", continuityHealth: "healthy", currentMapId: f.mapOneId, mapExecutionPhase: "gameplay" })
        .where(eq(schema.matchLiveSessions.id, f.sessionId));
      input.map = { ...input.map, mapId: f.mapOneId, name: "de_ancient" };
      input.series = { ...input.series, currentMapOrder: 1 };
      input.players = input.players.map((player: Record<string, unknown>, index: number) => ({ ...player, sourcePlayerId: f.steam64[index]! }));
      input.radar = null;
      input.capability = { ...input.capability, radarCurrent: false };
    }
    const before = publications.length;
    state.sqlDelayMs = 95;
    state.sqlRoundTrips = 0;
    try {
      const response = await POST(new Request("http://local.test/api/mizar/live", {
        method: "POST", headers: { authorization: `Bearer ${f.token}`, "x-rivalhub-authority": "1" }, body: JSON.stringify(input),
      }), { params: Promise.resolve({ operation: "live" }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: true });
      expect(publications).toHaveLength(before + 1);
      // BEGIN + gate + locked authority + COMMIT; no separate credential SELECT.
      expect(state.sqlRoundTrips).toBe(4);
      reports.push({ scenario: "hosted-sql-rtt", sqlRttMs: 95, observedLineup, sqlRoundTrips: state.sqlRoundTrips, accepted: true });
    } finally { state.sqlDelayMs = 0; }
  });

  it.each(["timeout", "429", "stalled-body", "invalid-body"] as const)("releases ingress after %s and accepts a fresh frame", async fault => {
    const f = await prepared();
    await delay(1500);
    state.mode = fault;
    expect(await ingestMizarLive(f.credentialHash, snapshot(f, 1), 1)).toEqual({ accepted: false, reason: "broadcast_unavailable" });
    await delay(1000);
    state.mode = "fast";
    expect(await ingestMizarLive(f.credentialHash, snapshot(f, 2), 1)).toEqual({ accepted: true });
  });

it("bounds credential-lock waits, rotates blocked sources and accepts fresh recovery", async () => {
    const fixtures = await Promise.all(Array.from({ length: 4 }, () => prepared()));
    await delay(1500);
    const contended = [0, 0, 0, 0];
    state.mode = "fast";
    const before = publications.length;
    for (let tick = 0; tick < 4; tick++) {
      const blocker = await monitor.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("LOCK TABLE mizar_installations IN ACCESS EXCLUSIVE MODE");
        // Keep the conflicting lock until all requests finish: credential lookup
        // now shares the transaction's 25ms lock budget instead of queuing outside it.
        const outcomes = await Promise.all(fixtures.map(async (f, i) => {
          const response = await upload(f, tick + 1);
          const outcome = await response.json();
          expect(outcome.accepted).toBe(false);
          expect(["contended", "capacity"]).toContain(outcome.reason);
          if (outcome.reason === "contended") contended[i]!++;
          return outcome.reason;
        }));
        expect(outcomes.filter(reason => reason === "contended")).toHaveLength(2);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      if (tick < 3) await delay(500);
    }
    expect(contended).toEqual([2, 2, 2, 2]);
    expect(publications).toHaveLength(before);
    await delay(1500);
    for (const f of fixtures) expect(await (await upload(f, 5)).json()).toEqual({ accepted: true });
    reports.push({ scenario: "bounded-credential-lock", contended, recovered: fixtures.length });
  });

  it("rejects unknown, revoked, other-installation and cross-competition HTTP credentials before publication", async () => {
    const f = await prepared();
    const other = await prepared();
    const sameCompetitionToken = `rh_mizar_${f.installationBId}_${"c".repeat(64)}`;
    await db.update(schema.mizarInstallations).set({ credentialHash: hashCredential(sameCompetitionToken) }).where(eq(schema.mizarInstallations.id, f.installationBId));
    await delay(1500);
    const before = publications.length;
    const post = (token: string, input = snapshot(f)) => POST(new Request("http://local.test/api/mizar/live", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "x-rivalhub-authority": "1" }, body: JSON.stringify(input),
    }), { params: Promise.resolve({ operation: "live" }) });
    const unknown = f.token.slice(0, -64) + "b".repeat(64);
    // Expire earlier demand tickets between different credentials so these
    // assertions exercise database authority rather than the fairness gate.
    expect((await post(unknown)).status).toBe(403);
    await delay(1500);
    expect((await post(sameCompetitionToken)).status).toBe(403);
    await delay(1500);
    expect((await post(other.token)).status).toBe(403);
    await delay(1500);
    expect((await post(f.token, { ...snapshot(f), competitionId: other.seasonId })).status).toBe(403);
    await db.update(schema.mizarInstallations).set({ revokedAt: new Date() }).where(eq(schema.mizarInstallations.id, f.installationId));
    expect((await post(f.token)).status).toBe(403);
    expect(publications).toHaveLength(before);
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
    expect((await slow).map(response => response.status)).toEqual([408, 408]);
    expect(cancelled).toBe(2);
    expect((await post("{" )).status).toBe(400);
    expect((await post("x".repeat(262145))).status).toBe(413);
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
      await ingestMizarLive(f.credentialHash, snapshot(f, 5), 1),
    ).toEqual({ accepted: false, reason: "broadcast_unavailable" });
    await delay(1000);
    state.mode = "fast";
    expect(
      await ingestMizarLive(f.credentialHash, snapshot(f, 5), 1),
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
          await ingestMizarLive(f.credentialHash, snapshot(f), 1),
        ).toEqual({ accepted: false, reason: "contended" });
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
            await ingestMizarLive(f.credentialHash, snapshot(f), 1),
          ).toEqual({ accepted: false, reason: "contended" });
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
      expect(await (await work).json()).toEqual({ accepted: false, reason: "frame_expired" });
      expect(publications.length).toBe(before);
    },
  );

it("holds authority fencing through send while revoke, handover and manual results contend", async () => {
    for (const change of ["revoke", "handover", "manual"] as const) {
      const f = await prepared();
      if (change === "manual") await db.update(schema.matchLiveSessions).set({ continuityHealth: "stale", autoCanonicalizationArmed: false }).where(eq(schema.matchLiveSessions.id, f.sessionId));
      state.mode = "fast";
      let releaseSend!: () => void;
      state.sendBarrier = new Promise<void>((resolve) => { releaseSend = resolve; });
      const before = publications.length;
      const live = ingestMizarLive(f.credentialHash, snapshot(f), 1);
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
      let lockWaiters = 0;
      try {
        // Hold the real HTTP response until PostgreSQL observes the contender.
        // A fixed sleep can sample before it acquires a connection under load.
        await expect.poll(async () => {
          const waits = await monitor.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
          );
          lockWaiters = waits.rows[0].n;
          return lockWaiters;
        }, { timeout: 1000, interval: 5 }).toBeGreaterThan(0);
        expect(committed).toBe(false);
      } finally {
        releaseSend();
        delete state.sendBarrier;
        await Promise.allSettled([live, mutate]);
      }
      await live;
      await mutate;
      reports.push({
        change,
        mutationMs: performance.now() - start,
        observedLockWaiters: lockWaiters,
      });
      if (change !== "manual")
        await expect(
          ingestMizarLive(f.credentialHash, snapshot(f, 2), 1),
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
