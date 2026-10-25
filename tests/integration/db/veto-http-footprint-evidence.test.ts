// Opt-in full HTTP evidence; ordinary PG CI skips starting a Next server.
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
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
import { seedFixture } from "./harness/mizar";

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
        await expect(choose).toBeVisible();
        const reply = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "POST"
          && response.request().postDataJSON().operation === "command");
        const started = performance.now();
        await choose.click();
        const response = await reply;
        const body = await response.json();
        const commandAckMs = performance.now() - started;
        expect(response.status()).toBe(200);
        expect(body).toMatchObject({ success: true, data: { outcome: "applied" } });
        await expect(choose).toHaveCount(0);
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
