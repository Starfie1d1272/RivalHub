// Opt-in full HTTP evidence; ordinary PG CI skips starting a Next server.
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { request, chromium } from "@playwright/test";
import { expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { parseLocalSupabaseStatus, buildLocalAppEnvironment } from "../../../scripts/db/local-environment";
import { createMajorBrowserScenarioFixture, cleanupMajorBrowserScenarioFixture } from "../../../scripts/db/major-browser-fixture";
import { seedFixture, type Fixture } from "./harness/mizar";
import { mizarSnapshot } from "./harness/mizar-snapshot";
import { hashCredential } from "@/lib/mizar/installation";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";

it.skipIf(process.env.RIVALHUB_BP_HTTP_EVIDENCE !== "1")("measures full BP HTTP application database footprint", async () => {
  const status = parseLocalSupabaseStatus(execFileSync(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  status.databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL!;
  const env = buildLocalAppEnvironment(status);
  Object.assign(env, { NODE_ENV: "development" });
  env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3096";
  env.RIVALHUB_E2E_AUTH_BOOTSTRAP = "1";
  env.PRODUCT_TELEMETRY_ENABLED = "0";
  delete env.VERCEL_ENV;
  const artifacts = resolve(".agent-tmp/bp-browser");
  mkdirSync(artifacts, { recursive: true });
  const scenarioId = `bp-browser-${randomUUID().slice(0,8)}`;
  const credentials = resolve(artifacts, "scenario.credentials.json");

  if (existsSync(credentials)) {
    const stale = JSON.parse(readFileSync(credentials, "utf8"));
    if (!stale.scenarioId.startsWith("bp-browser-") || stale.profile !== "stats") throw new Error("Unexpected fixture manifest");
    const auth = createClient(status.apiUrl, status.serviceRoleKey, { auth: { persistSession: false } });
    for (const id of stale.authUserIds) { const result = await auth.auth.admin.deleteUser(id); if (result.error) throw result.error; }
    unlinkSync(credentials);
  }
  const scenario = await createMajorBrowserScenarioFixture(scenarioId, credentials, "stats", env);
  const admin = scenario.accounts.find(account => account.key === "admin")!;
  const other = scenario.accounts.find(account => account.key === "player2")!;
  const f = await seedFixture({ isTest: true });
  await db.update(schema.matches).set({ testConfig: { operatorAId: admin.userId, operatorBId: other.userId, mapPool: ["de_ancient","de_mirage","de_nuke","de_dust2","de_inferno","de_anubis","de_train"] } }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchVetoSessions).set({ completedAt: null, privilegedEntryId: f.entryAId, currentTurnKey: "choose-veto-team-a", mapPoolSnapshot: ["de_ancient","de_mirage","de_nuke","de_dust2","de_inferno","de_anubis","de_train"], turnStartedAt: sql`clock_timestamp()`, turnDeadlineAt: sql`clock_timestamp() + interval '45 seconds'`, pausedAt: sql`clock_timestamp()`, pausedBy: admin.userId, pauseReason: "browser recovery fixture" }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
  await db.insert(schema.matchVetoTimeoutIncidents).values({ matchId: f.matchId, entryId: f.entryAId, turnKey: "choose-veto-team-a", representativeUserId: admin.userId, deadlineAt: new Date(), resolvedAt: new Date(), eligibleOptions: [f.entryAId,f.entryBId], selectedOptions: [f.entryAId] }).returning();
  const stream = createWriteStream(resolve(artifacts, "next-server.log"));
  const server = spawn(resolve("node_modules/.bin/next"), ["dev", "--hostname", "127.0.0.1", "--port", "3096"], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout!.pipe(stream); server.stderr!.pipe(stream);
  const context = await request.newContext({ baseURL: env.NEXT_PUBLIC_APP_URL });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw new Error(`Next exited: ${server.exitCode}`);
      try { ready = (await fetch(`${env.NEXT_PUBLIC_APP_URL}/favicon.ico`)).ok; } catch { /* startup */ }
      if (ready) break; await delay(500);
    }
    expect(ready).toBe(true);
    const auth = await context.post("/api/test/e2e/auth", { data: { email: admin.email, password: scenario.password } });
    expect(auth.status()).toBe(200);
    const endpoint = `/api/matches/${f.matchId}/veto-room`;
    if (process.env.RIVALHUB_CLI_HTTP_FIXTURE_EVIDENCE === "1") {
      const privateManifest = resolve(artifacts, `http-fixture-${randomUUID()}.json`);
      const fixtureCli = (command: string, ...args: string[]) => {
        try { return execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/db/mizar-http-resource-fixture.ts", command, privateManifest, ...args], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }); }
        catch { throw new Error("Local HTTP fixture CLI failed; private data omitted"); }
      };
      try {
        fixtureCli("create");
        expect(statSync(privateManifest).mode & 0o777).toBe(0o600);
        const manifest = JSON.parse(readFileSync(privateManifest, "utf8")) as { producers: Array<{ fixture: Fixture; credential: string; liveTemplate: unknown; reliableEnvelope: unknown }> };
        const post = async (operation: string, producer: typeof manifest.producers[number], data: unknown) => {
          try {
            const response = await context.post(`/api/mizar/${operation}`, { headers: { authorization: `Bearer ${producer.credential}`, "x-rivalhub-authority": String(producer.fixture.authorityRevision) }, data });
            return { status: response.status(), body: await response.json() };
          } catch { throw new Error("Local synthetic HTTP transport failed; headers and payload omitted"); }
        };
        const live = await Promise.all(manifest.producers.map(producer => post("live", producer, producer.liveTemplate)));
        expect(live).toEqual([{ status: 200, body: { accepted: true } }, { status: 200, body: { accepted: true } }]);
        const reliable = await Promise.all(manifest.producers.map(producer => post("reliable", producer, producer.reliableEnvelope)));
        expect(reliable).toEqual([{ status: 200, body: { outcome: "canonicalized", duplicate: false } }, { status: 200, body: { outcome: "canonicalized", duplicate: false } }]);
        const receipts = JSON.parse(fixtureCli("verify", "--require-receipts").trim().split("\n").at(-1)!);
        const evidence = { sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), environment: "same Next dev HTTP + real Local Supabase", privateMode: "0600", differentMatches: true, liveAccepted: 2, reliableCanonicalized: 2, receipts };
        writeFileSync(resolve(artifacts, "http-fixture-cli.json"), JSON.stringify(evidence, null, 2));
        console.info("HTTP_FIXTURE_CLI", JSON.stringify(evidence));
      } finally { fixtureCli("cleanup"); }
    }
    if (process.env.RIVALHUB_LIVE_HTTP_EVIDENCE === "1") {
      const fixtures = await Promise.all(Array.from({ length: 3 }, () => seedFixture()));
      const credentials = fixtures.map(item => `rh_mizar_${item.installationId}_${"a".repeat(64)}`);
      await Promise.all(fixtures.map((item, index) => db.update(schema.mizarInstallations)
        .set({ credentialHash: hashCredential(credentials[index]!) }).where(eq(schema.mizarInstallations.id, item.installationId))));
      const reliable = fixtures[2]!;
      const event = { schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION, idempotencyKey: `http-${randomUUID()}`,
        cursor: { producerInstanceId: reliable.producerInstanceId, liveSessionId: reliable.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 },
        observedAt: new Date().toISOString(), matchId: reliable.matchId, competitionId: reliable.seasonId, contextRevision: reliable.contextRevision,
        mapId: reliable.mapOneId, mapName: "de_ancient", entryAId: reliable.entryAId, entryBId: reliable.entryBId,
        evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
        kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } };
      const observations: Array<{ operation: string; startedMs: number; finishedMs: number; status: number; bytes: number }> = [];
      const origin = performance.now();
      const observe = async (operation: string, work: () => ReturnType<typeof context.get>) => {
        const startedMs = performance.now() - origin;
        const response = await work();
        const body = await response.body();
        observations.push({ operation, startedMs, finishedMs: performance.now() - origin, status: response.status(), bytes: body.length });
        return JSON.parse(body.toString());
      };
      const machineHeaders = (index: number) => ({ authorization: `Bearer ${credentials[index]}`, "x-rivalhub-authority": "1" });
      const anonymous = await request.newContext({ baseURL: env.NEXT_PUBLIC_APP_URL });
      try {
        const result = await Promise.all([
          ...fixtures.slice(0, 2).map((item, index) => observe(`live-${index + 1}`, () => context.post("/api/mizar/live", { headers: machineHeaders(index), data: mizarSnapshot(item) }))),
          observe("reliable-map-end", () => context.post("/api/mizar/reliable", { headers: machineHeaders(2), data: { event } })),
          observe("authenticated-veto-read", () => context.get(endpoint)),
          observe("anonymous-viewer-token", () => anonymous.get(`/api/matches/${fixtures[0]!.matchId}/live-viewer`)),
        ]);
        expect(result.slice(0, 2)).toEqual([{ accepted: true }, { accepted: true }]);
        expect(result[2]).toEqual({ outcome: "canonicalized", duplicate: false });
        expect(result[3]).toMatchObject({ success: true, data: { permissions: { isAdmin: true } } });
        expect(typeof result[4].token).toBe("string");
        const commonInFlightMs = Math.min(...observations.map(row => row.finishedMs)) - Math.max(...observations.map(row => row.startedMs));
        expect(commonInFlightMs).toBeGreaterThan(0);
        const evidence = { sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          environment: "same Next HTTP application + loopback PostgreSQL + real Local Supabase Auth/Realtime", observations, commonInFlightMs,
          note: "Five overlapping client HTTP requests. No claim that database statements or provider delivery overlapped for this full interval. No tokens, payloads or credentials retained." };
        writeFileSync(resolve(artifacts, "mixed-http.json"), JSON.stringify(evidence, null, 2));
        console.info("MIXED_HTTP_EVIDENCE", JSON.stringify(evidence));
      } finally { await anonymous.dispose(); }
    }

    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS extensions`);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions`);
    const statementSnapshot = async () => (await db.execute<{ queryid: string; query: string; calls: string; rows: string }>(sql`
      SELECT queryid::text, query, calls::text, rows::text FROM extensions.pg_stat_statements
      WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND query NOT ILIKE '%pg_stat_statements%'
    `)).rows;
    const footprints: unknown[] = [];
    const measure = async (label: string, request: () => Promise<{ status(): number; json(): Promise<{ success: boolean; data: { receipt?: { changed: boolean } } }> }>) => {
      const beforeStats = new Map((await statementSnapshot()).map(row => [row.queryid, row]));
      const response = await request(); expect(response.status()).toBe(200);
      const body = await response.json(); expect(body.success).toBe(true);
      if (label.startsWith("POST")) expect(body.data.receipt?.changed).toBe(false);
      const counters: Record<string, number> = {}; let rows = 0;
      for (const row of await statementSnapshot()) {
        const prior = beforeStats.get(row.queryid);
        const count = Number(row.calls)-Number(prior?.calls ?? 0);
        if (!count) continue;
        const command = row.query.trim().split(/\s+/)[0]!.toUpperCase();
        counters[command] = (counters[command] ?? 0)+count;
        rows += Number(row.rows)-Number(prior?.rows ?? 0);
      }
      footprints.push({ label, counters, returnedOrAffectedRows: rows, source: "whole HTTP application DB pg_stat_statements delta, includes auth/scope and transaction control; excludes separate Auth service DB and wire bytes" });
    };
    const anonymous = await request.newContext({ baseURL: env.NEXT_PUBLIC_APP_URL });
    await anonymous.get(endpoint); await context.get(endpoint);
    await measure("GET anonymous warm", () => anonymous.get(endpoint));
    await measure("GET authenticated warm", () => context.get(endpoint));
    const reconcileRequest = () => context.post(endpoint, { headers: { Origin: env.NEXT_PUBLIC_APP_URL! }, data: { operation: "reconcile" } });
    await reconcileRequest();
    await measure("POST reconcile no-change warm", reconcileRequest);
    await anonymous.dispose();
    writeFileSync(resolve(artifacts, "http-footprint.json"), JSON.stringify(footprints, null, 2));
    console.info("BP_HTTP_FOOTPRINT", JSON.stringify(footprints));
    const draft = await seedFixture({ isTest: true });
    await db.update(schema.seasons).set({ status: 'draft' }).where(eq(schema.seasons.id, draft.seasonId));
    const draftEndpoint = `/api/matches/${draft.matchId}/veto-room`;
    await context.get(draftEndpoint);
    await measure('GET authenticated draft warm', () => context.get(draftEndpoint));
    const draftReconcile = () => context.post(draftEndpoint, { headers: { Origin: env.NEXT_PUBLIC_APP_URL! }, data: { operation: 'reconcile' } });
    await draftReconcile();
    await measure('POST reconcile authenticated draft no-change warm', draftReconcile);
    writeFileSync(resolve(artifacts, `http-footprint-${process.env.BP_FOOTPRINT_LABEL}.json`), JSON.stringify(footprints, null, 2));
    console.info('BP_FULL_HTTP', JSON.stringify(footprints));
    if (process.env.RIVALHUB_BP_BROWSER_EVIDENCE === "1") {
      await db.update(schema.matchVetoSessions).set({ pausedAt: null, pausedBy: null, pauseReason: null,
        turnStartedAt: sql`clock_timestamp()`, turnDeadlineAt: sql`clock_timestamp() + interval '45 seconds'`,
      }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
      const browser = await chromium.launch();
      try {
        const viewer = await browser.newContext({ storageState: await context.storageState() });
        const page = await viewer.newPage();
        await page.goto(`${env.NEXT_PUBLIC_APP_URL}/${f.seasonId}/matches/${f.matchId}/veto`);
        const choose = page.getByRole("button", { name: "由 Provider A 先禁图", exact: true });
        await choose.waitFor({ state: "visible" });
        const reply = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST"
          && response.request().postDataJSON().operation === "command");
        const started = performance.now();
        await choose.click();
        const response = await reply;
        const body = await response.json();
        const commandAckMs = performance.now() - started;
        expect(response.status()).toBe(200);
        expect(body).toMatchObject({ success: true, data: { outcome: "applied" } });
        await choose.waitFor({ state: "detached" });
        const roomPresentedMs = performance.now() - started;
        const measurement = { sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          environment: "isolated loopback PostgreSQL + Local Supabase Auth + Next dev + Chromium", samples: 1,
          commandAckMs, roomPresentedMs, outcome: body.data.outcome,
          note: "HTTP acknowledgement includes the existing projection workflow; room presentation is a distinct browser observation, not LCP or production SLO." };
        writeFileSync(resolve(artifacts, "command-presentation.json"), JSON.stringify(measurement, null, 2));
        console.info("BP_COMMAND_PRESENTATION", JSON.stringify(measurement));
      } finally { await browser.close(); }
    }
  } finally {
    await context.dispose();
    server.kill('SIGTERM'); stream.end();
    await cleanupMajorBrowserScenarioFixture(scenarioId, credentials, 'stats', env);
  }
}, 240_000);
