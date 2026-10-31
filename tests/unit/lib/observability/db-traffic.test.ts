import { expect, it } from "vitest";
import { queryShape } from "@/lib/observability/db-traffic";

it("distinguishes identifiers while normalizing literals, comments and parameters", () => {
  const first = queryShape("select account from users where id = $1 and name = 'secret-one'");
  expect(first).toMatch(/^q[0-9a-f]{16}$/);
  expect(queryShape("select account from users where id = $2 and name = 'secret-two'")).toBe(first);
  expect(queryShape("select account from profiles where id = $2 and name = 'secret-two'")).not.toBe(first);
  expect(queryShape("select account from users where id = $1")).not.toBe(first);
  expect(queryShape("-- secret-one\nselect 'secret-two'")).toBe(queryShape("select 'other'"));
  expect(queryShape("select " + "a,".repeat(4097))).toBe("unknown");
  expect(queryShape(String.raw`select E'one\'secret' from records`)).toBe(queryShape(String.raw`select E'two\'private' from records`));
});

it("accepts only a matching v2 acknowledgement", async () => {
  const { vi } = await import("vitest");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-v2-"));
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const send = vi.fn(async (_url: unknown, init: { body: string }) => { const batch = JSON.parse(init.body); return Response.json({ protocol: 2, id: batch.id, digest: await digestDbTraffic(batch), status: "accepted" }); });
  vi.stubGlobal("fetch", send);
  try {
    recordDbTraffic("unknown", "unknown", 0, 1, false); flushDbTraffic();
    // Await the whole seal, send, ACK persistence and drain before inspecting or
    // removing the spool. Disk sync can take longer than the default waitFor.
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false), { timeout: 10000 });
    expect(send).toHaveBeenCalledOnce();
    const { readFile } = await import("node:fs/promises");
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8")).batches).toHaveLength(0);
  } finally {
    if (host[slot]) await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false), { timeout: 10000 });
    delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true });
  }
}, 15000);

it("does not retain disabled observations for later delivery", async () => {
  const { vi } = await import("vitest");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  vi.stubEnv("DB_TRAFFIC_KEY", "");
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  try {
    recordDbTraffic("unknown", "unknown", 0, 1, false);
    flushDbTraffic();
    vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3));
    flushDbTraffic();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

it("classifies missing and unmapped context without emitting route data", async () => {
  const { dbTrafficSource, withDbTrafficSource } = await import("@/lib/observability/db-traffic");
  expect(dbTrafficSource()).toBe("context.absent");
  expect(dbTrafficSource("/private/user-id?token=secret")).toBe("context.unmapped");
  expect(dbTrafficSource("/api/mizar/match")).toBe("mizar");
  expect(await withDbTrafficSource("predictions.read", async () => {
    await Promise.resolve();
    return dbTrafficSource("/private/user-id");
  })).toBe("predictions.read");
  expect(dbTrafficSource()).toBe("context.absent");
});

it("keeps nested stats attribution and restores the match page scope across async work", async () => {
  const { dbTrafficSource, withDbTrafficSource } = await import("@/lib/observability/db-traffic");
  expect(await withDbTrafficSource("match.page", async () => {
    await Promise.resolve();
    const before = dbTrafficSource();
    const lazy = await Promise.resolve({ then: (resolve: (value: string) => void) => resolve(dbTrafficSource()) });
    const nested = await Promise.all(["stats.match", "stats.lineup", "season.catalog.fill"].map(source =>
      withDbTrafficSource(source as "stats.match" | "stats.lineup" | "season.catalog.fill", async () => { await Promise.resolve(); return dbTrafficSource(); }),
    ));
    return [before, lazy, ...nested, dbTrafficSource()];
  })).toEqual(["match.page", "match.page", "stats.match", "stats.lineup", "season.catalog.fill", "match.page"]);
  expect(dbTrafficSource()).toBe("context.absent");
});

it.each(["empty", "mismatch"])("keeps a batch when a %s response is not a valid v2 ACK", async kind => {
  const { vi } = await import("vitest"); const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-invalid-ack-"));
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const send = vi.fn(async () => kind === "empty" ? new Response(null, { status: 204 }) : Response.json({ protocol: 2, id: "wrong", digest: "wrong", status: "accepted" }));
  vi.stubGlobal("fetch", send);
  try {
    recordDbTraffic("unknown", "unknown", 0, 1, false); flushDbTraffic();
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
    const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    expect(stored.batches).toHaveLength(1); expect(stored.batches[0].attempted).toBe(true);
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});

it("starts the current hour after an idle period with no observations", async () => {
  const { vi } = await import("vitest"); const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
  const { dbTrafficSource, recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-idle-")); let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const sent: Array<{ id: string; at: number }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { const batch = JSON.parse(init.body); sent.push(batch); return Response.json({ protocol: 2, id: batch.id, digest: await digestDbTraffic(batch), status: "accepted" }); }));
  try {
    dbTrafficSource(); now += 25 * 3600000;
    recordDbTraffic("unknown", "unknown", 1, 1, false); flushDbTraffic();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(Math.floor(sent[0].at / 3600000)).toBe(Math.floor(now / 3600000));
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
  } finally { delete host[slot]; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});

it("does not persist an unsafe producer body and continues with a later safe batch", async () => {
  const { vi } = await import("vitest"); const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-unsafe-"));
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const sent: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { const body = JSON.parse(init.body); sent.push(init.body); return Response.json({ protocol: 2, id: body.id, digest: await digestDbTraffic(body), status: "accepted" }); }));
  try {
    recordDbTraffic("unknown", "private-sql-marker", 1, 1, false); flushDbTraffic();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
    expect(sent.join("")).not.toContain("private-sql-marker");
    expect(await readFile(join(root, "state.json"), "utf8")).not.toContain("private-sql-marker");
    recordDbTraffic("unknown", "unknown", 1, 1, false); flushDbTraffic();
    await vi.waitFor(() => expect(sent.some(body => JSON.parse(body).rows?.length === 1)).toBe(true));
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});

it("captures the previous hour while a prior ACK is still in flight", async () => {
  const { vi } = await import("vitest"); const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-inflight-hour-")); let now = Math.floor(1_800_000_000_000 / 3600000) * 3600000 + 100;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const sent: Array<{ id: string; at: number }> = []; let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { const body = JSON.parse(init.body); sent.push(body); if (sent.length === 1) await held; return Response.json({ protocol: 2, id: body.id, digest: await digestDbTraffic(body), status: "accepted" }); }));
  try {
    const oldHour = Math.floor(now / 3600000); recordDbTraffic("unknown", "unknown", 1, 1, false); flushDbTraffic();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    recordDbTraffic("unknown", "unknown", 1, 1, false); now += 3600000;
    recordDbTraffic("unknown", "unknown", 1, 1, false); flushDbTraffic(); release();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
    flushDbTraffic(); await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(3));
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
    expect(sent.map(item => Math.floor(item.at / 3600000))).toEqual([oldHour, oldHour, oldHour + 1]);
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
  } finally { release(); delete host[slot]; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});

it("shares an eight-request budget across repeated flushes in the same 20 seconds", async () => {
  const { vi } = await import("vitest"); const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const { flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-budget-")); let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  const initial = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(initial, identity);
  for (let i = 0; i < 10; i++) await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 0 }), now);
  initial.close();
  const send = vi.fn(async (_url: unknown, init: { body: string }) => { const body = JSON.parse(init.body); return Response.json({ protocol: 2, id: body.id, digest: await digestDbTraffic(body), status: "accepted" }); });
  vi.stubGlobal("fetch", send);
  try {
    const waitForDrain = () => vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false), { timeout: 10000 });
    flushDbTraffic(); await waitForDrain(); expect(send).toHaveBeenCalledTimes(8);
    flushDbTraffic(); await waitForDrain(); expect(send).toHaveBeenCalledTimes(8);
    now += 20001; flushDbTraffic(); await waitForDrain(); expect(send).toHaveBeenCalledTimes(11);
  } finally {
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false), { timeout: 10000 });
    delete host[slot]; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true });
  }
}, 15000);

type TestTrafficState = { sending: boolean; budgetStartedAt: number; budgetSent: number; rows: Map<string, { queries: number }>; delivery: Promise<unknown> };

it("does not recursively seal continuous residual traffic after the delivery budget is exhausted", async () => {
  const { vi } = await import("vitest"); const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, TestTrafficState>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-continuous-")); const now = Date.now();
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const initial = await DbTrafficSpool.open(root); const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" }; const delivery = new DbTrafficDelivery(initial, identity);
  for (let i = 0; i < 255; i++) await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 100 }), now);
  initial.close();
  try {
    recordDbTraffic("unknown", "unknown", 1, 1, false); host[slot].budgetStartedAt = Date.now(); host[slot].budgetSent = 8;
    flushDbTraffic();
    const timer = setInterval(() => recordDbTraffic("unknown", "unknown", 1, 1, false), 1);
    await new Promise(resolve => setTimeout(resolve, 800)); clearInterval(timer);
    await vi.waitFor(() => expect(host[slot].sending).toBe(false));
    const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    expect(stored.batches).toHaveLength(256); expect(stored.gaps.map((item: { body: string }) => JSON.parse(item.body).reason)).not.toContain("overflow");
    expect([...host[slot].rows.values()].some((row: { queries: number }) => row.queries > 0)).toBe(true);
  } finally { delete host[slot]; vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("retains an unobserved connection after it disconnects before the sampler", async () => {
  const { vi } = await import("vitest"); const { EventEmitter } = await import("node:events");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { observeDbStream, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, TestTrafficState>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-unobserved-"));
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches"); vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  try {
    const client = new EventEmitter(); observeDbStream(client as never); client.emit("end"); flushDbTraffic();
    await vi.waitFor(() => expect(host[slot].sending).toBe(false), { timeout: 10000 });
    const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    expect(stored.gaps.some((item: { body: string }) => JSON.parse(item.body).reason === "unknown_tail")).toBe(true);
    expect(stored.coverageUnknownSince).not.toBeNull();
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("retains the original capture boundary when startup is delayed and more traffic arrives", async () => {
  const { vi } = await import("vitest"); const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, TestTrafficState>; const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  let now = 1_800_000_000_000; vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3)); vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  try {
    recordDbTraffic("unknown", "unknown", 1, 1, false);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const seal = vi.fn(async () => {}); host[slot].delivery = Promise.resolve({ start: () => held, prune: async () => {}, seal, drain: async () => {} });
    flushDbTraffic(); now += 5000; recordDbTraffic("unknown", "unknown", 1, 1, false); release();
    await vi.waitFor(() => expect(host[slot].sending).toBe(false));
    expect(seal).toHaveBeenCalledWith(expect.any(String), now, undefined, now - 5000);
    expect(host[slot].rows.get("unknown:unknown")?.queries).toBe(1);
  } finally { delete host[slot]; vi.restoreAllMocks(); vi.unstubAllEnvs(); }
});

it("durably captures unsealed traffic on a real SIGTERM and restores it before sending", async () => {
  const { spawn } = await import("node:child_process"); const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-term-"));
  const script = `const { recordDbTraffic, flushDbTraffic } = require('./src/lib/observability/db-traffic.ts');
    process.env.DB_TRAFFIC_KEY = 'x'.repeat(32); process.env.PRODUCT_TELEMETRY_ENDPOINT = 'https://example.invalid/v1/batches'; process.env.DB_TRAFFIC_SPOOL_DIRECTORY = process.argv[1];
    global.fetch = async () => new Response(null, { status: 503 });
    process.on('SIGTERM', () => process.exit(143));
    recordDbTraffic('unknown', 'unknown', 1, 1, false); flushDbTraffic();
    const poll = setInterval(() => { const s = process[Symbol.for('rivalhub.db-traffic.v3')]; if (!s?.deliveryStarted || s.sending) return; clearInterval(poll); recordDbTraffic('unknown', 'unknown', 2, 1, false); process.stdout.write('ready\\n'); setInterval(() => {}, 1000); }, 5);`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
    child.kill("SIGTERM"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, { process: crypto.randomUUID(), release: "new", deployment: "new" }); await delivery.start(Date.now());
    const batches = spool.snapshot().batches.map(item => JSON.parse(item.body));
    expect(batches.map(batch => batch.rows[0]?.rows).sort()).toEqual([1, 2]);
    expect(batches.every(batch => batch.release === "unknown")).toBe(true); spool.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("does not persist an unsafe pending snapshot during process exit", async () => {
  const { spawn } = await import("node:child_process"); const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "traffic-unsafe-exit-"));
  const script = `const { recordDbTraffic, flushDbTraffic } = require('./src/lib/observability/db-traffic.ts');
    process.env.DB_TRAFFIC_KEY='x'.repeat(32); process.env.PRODUCT_TELEMETRY_ENDPOINT='https://example.invalid/v1/batches'; process.env.DB_TRAFFIC_SPOOL_DIRECTORY=process.argv[1];
    process.on('SIGTERM', () => process.exit(143)); flushDbTraffic();
    const poll=setInterval(async () => { const s=process[Symbol.for('rivalhub.db-traffic.v3')]; if (!s?.deliveryStarted || s.sending) return; clearInterval(poll);
      const delivery=await s.delivery; delivery.prune=()=>new Promise(()=>{}); recordDbTraffic('unknown','private-sql-canary',1,1,false); flushDbTraffic(); process.stdout.write('ready\\n'); },5);`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
    child.kill("SIGTERM"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
    const names = (await readdir(root)).filter(name => /^exit-.*\.json$/.test(name)); expect(names).toHaveLength(1);
    const body = await readFile(join(root, names[0]), "utf8"); expect(body).not.toContain("private-sql-canary");
    expect(JSON.parse(body)).toMatchObject({ batches: [], unknownAt: expect.any(Number) });
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("reports a failed exit fsync and preserves unknown coverage on restart", async () => {
  const { spawn } = await import("node:child_process"); const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-exit-fsync-"));
  const script = `const fs=require('node:fs'); const { recordDbTraffic, flushDbTraffic }=require('./src/lib/observability/db-traffic.ts');
    process.env.DB_TRAFFIC_KEY='x'.repeat(32); process.env.PRODUCT_TELEMETRY_ENDPOINT='https://example.invalid/v1/batches'; process.env.DB_TRAFFIC_SPOOL_DIRECTORY=process.argv[1];
    process.on('SIGTERM',()=>process.exit(143)); flushDbTraffic(); const poll=setInterval(()=>{ const s=process[Symbol.for('rivalhub.db-traffic.v3')]; if (!s?.deliveryStarted || s.sending) return; clearInterval(poll); recordDbTraffic('unknown','unknown',1,1,false); fs.fsyncSync=()=>{throw new Error('fixture EIO')}; process.stdout.write('ready\\n'); },5);`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] }); let errors = "";
  child.stderr.on("data", data => { errors += String(data); });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
    child.kill("SIGTERM"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
    expect(errors).toContain('"event":"db_traffic.exit_capsule_failure"');
    const spool = await DbTrafficSpool.open(root); await new DbTrafficDelivery(spool, { process: crypto.randomUUID(), release: "v", deployment: "d" }).start(Date.now());
    expect(spool.snapshot().coverageUnknownSince).not.toBeNull(); spool.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 15000);
