// Synthetic local evidence only. No deployment, external collector or real account data.
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from '@playwright/test';
import { accountKey, signTicket } from '../../src/lib/telemetry/ticket.ts';
import { Miniflare } from 'miniflare';
const require = createRequire(import.meta.url);
// tsx's declared transpiler, used only to measure the actual client bundle.
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'rivalhub-telemetry-'));
let browser; let runtime;
try {
  const bundle = await build({ entryPoints: ['src/lib/telemetry/client.ts'], bundle: true, write: false, format: 'iife', globalName: 'RivalTelemetry', platform: 'browser', minify: true });
  const bytes = bundle.outputFiles[0].contents;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://fixture.invalid/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Local telemetry fixture</title>' }));
  await page.goto('https://fixture.invalid/');
  await page.addScriptTag({ content: new TextDecoder().decode(bytes) });
  const measured = await page.evaluate(async () => {
    const telemetry = window.RivalTelemetry;
    let clock = Date.now(); const initialClock = clock; const bodies = []; const durations = [];
    Date.now = () => clock;
    window.fetch = async (_url, options) => { bodies.push(options.body); return new Response(null, { status: 204 }); };
    telemetry.configureTelemetry({ endpoint: 'https://receiver.invalid/v1/batches', ticket: 'fixture-ticket', identity: 'fixture-account', expiresAt: clock + 86400000 });
    const action = telemetry.observeAction('free-predictions.submitFreePrediction', async () => ({ success: true, data: null }));
    for (let minute = 0; minute < 30; minute++) {
      history.replaceState(null, '', `/stats?tab=players&teamFilter=${minute}`); telemetry.recordPage();
      for (let j = 0; j < 2; j++) { const start = performance.now(); await action(); durations.push(performance.now() - start); }
      telemetry.flushTelemetry(); await Promise.resolve(); await Promise.resolve();
      clock += 60000;
    }
    durations.sort((a, b) => a - b);
    return { bodies, events: bodies.map(b => JSON.parse(b).events).flat(), initialClock, requests: bodies.length, wireBytesWithoutTicket: bodies.reduce((n, b) => n + new TextEncoder().encode(b).byteLength, 0), operationOverheadMs: { p50: durations[Math.floor(durations.length * .5)], p95: durations[Math.floor(durations.length * .95)], max: durations.at(-1) } };
  });
  const sqlite = new DatabaseSync(join(directory, 'telemetry.sqlite'));
  sqlite.exec(await readFile('workers/telemetry/schema.sql', 'utf8'));
  const insert = sqlite.prepare('INSERT INTO batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const perDay = [];
  const started = performance.now();
  // A seven-day 30-session/day cohort, with the actual Chromium-produced event bodies.
  sqlite.exec('BEGIN');
  for (let day = 0; day < 7; day++) for (let user = 0; user < 30; user++) {
    let index = 0;
    const ticketId = randomUUID(); const sessionId = randomUUID();
    const account = createHash("sha256").update(`fixture-${user}`).digest("base64url");
    for (const body of measured.bodies) {
      const events = JSON.parse(body).events.map(event => ({ ...event, session: sessionId, at: event.at + day * 86400000 }));
      const json = JSON.stringify(events);
      insert.run(ticketId, JSON.parse(body).id, measured.initialClock + day * 86400000 + index++ * 60000, measured.initialClock + (day + 7) * 86400000, new Date(measured.initialClock + day * 86400000).toISOString().slice(0, 10), account, sessionId, 'user', 'a'.repeat(40), 'preview', Buffer.byteLength(json), json);
    }
  }
  sqlite.exec('COMMIT');
  const insertMs = performance.now() - started;
  const storageBytes = sqlite.prepare('PRAGMA page_count').get().page_count * sqlite.prepare('PRAGMA page_size').get().page_size;
  sqlite.close();
  for (const sessions of [10, 30, 100]) perDay.push({ sessions, events: measured.events.length * sessions, requests: measured.requests * sessions, wireBytesWith900ByteTicket: (measured.wireBytesWithoutTicket + measured.requests * 900) * sessions, fits5000BatchDailyBudget: measured.requests * sessions <= 5000 });
  const bindings = { SIGNING_KEY: 'fixture-signing-key'.repeat(3), ADMIN_KEY: 'fixture-admin-key'.repeat(3), ALLOWED_ORIGIN: 'https://fixture.invalid', ACCEPTING: '1', RETENTION_APPROVED: '1' };
  const signingTimes = [];
  let signedTicket;
  for (let index = 0; index < 100; index++) {
    const start = performance.now();
    signedTicket = await signTicket({ v: 1, id: randomUUID(), account: await accountKey('fixture-user', 'fixture-account-key'.repeat(3)), role: 'user', release: 'a'.repeat(40), environment: 'preview', origin: bindings.ALLOWED_ORIGIN, exp: Date.now() + 3600000 }, bindings.SIGNING_KEY);
    signingTimes.push(performance.now() - start);
  }
  const workerBundle = await build({ entryPoints: ['workers/telemetry/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  runtime = new Miniflare({ modules: true, script: workerBundle.outputFiles[0].text, compatibilityDate: '2026-07-30', bindings, d1Databases: ['DB'] });
  const d1 = await runtime.getD1Database('DB');
  const statements = (await readFile('workers/telemetry/schema.sql', 'utf8')).replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
  await d1.batch(statements.map(sql => d1.prepare(sql)));
  const receiverTimes = [];
  for (const body of measured.bodies) {
    const input = JSON.parse(body); input.ticket = signedTicket;
    input.events = input.events.map(event => ({ ...event, at: Date.now() }));
    const start = performance.now();
    const response = await runtime.dispatchFetch('https://worker.invalid/v1/batches', { method: 'POST', headers: { origin: bindings.ALLOWED_ORIGIN }, body: JSON.stringify(input) });
    if (response.status !== 204) throw new Error(`Local receiver rejected fixture: ${response.status}`);
    receiverTimes.push(performance.now() - start);
  }
  signingTimes.sort((a, b) => a - b); receiverTimes.sort((a, b) => a - b);
  const receiver = { acceptedBatches: measured.bodies.length, ticketSigningP95Ms: signingTimes[94], localWorkerRequestWallP95Ms: receiverTimes[Math.floor(receiverTimes.length * .95)], d1: await d1.prepare('SELECT count(*) AS batches FROM batches').all() };
  console.log(JSON.stringify({ receiver, scenario: '30 minutes/session; each minute one navigation/filter + two completed explicit actions; idle polling absent', browser: await browser.version(), bundle: { minifiedBytes: bytes.length, gzipBytes: gzipSync(bytes).length }, perSession: { requests: measured.requests, events: measured.events.length, operationOverheadMs: measured.operationOverheadMs }, perDay, sqlite: { sessionsPerDay: 30, days: 7, batches: 30 * 7 * measured.requests, allocatedBytesIncludingIndexes: storageBytes, insertWallMs: insertMs }, limits: 'Synthetic Chromium and local SQLite, not Cloudflare CPU, D1 billed rows, shared quota headroom or production traffic. Ticket overhead conservatively adds 900 bytes/batch. No automatic rollout.' }, null, 2));
} finally { await browser?.close(); await runtime?.dispose(); await rm(directory, { recursive: true, force: true }); }
