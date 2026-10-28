import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ pools: [] as FakePool[], drizzle: vi.fn(), capture: vi.fn(), log: vi.fn() }));
vi.mock("@/db/pool", () => ({ DatabasePool: FakePool }));
vi.mock("@/db/schema", () => ({}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: fake.drizzle }));
vi.mock("@/lib/observability/logger", () => ({ captureException: fake.capture, logEvent: fake.log }));

class FakePool extends EventEmitter {
  totalCount = 0; idleCount = 0; waitingCount = 0;
  calls: unknown[][] = []; failures: unknown[] = []; endCalls = 0;
  drain: Promise<void> | null = null; finishDrain: (() => void) | null = null;
  constructor(public options: Record<string, unknown>) { super(); fake.pools.push(this); }
  query(...args: unknown[]) {
    this.calls.push(args); const error = this.failures.shift();
    const result = { rows: [{ pool: fake.pools.indexOf(this) }], rowCount: 1 };
    const callback = args.at(-1);
    if (typeof callback === "function") { queueMicrotask(() => callback(error ?? null, error ? undefined : result)); return; }
    return error ? Promise.reject(error) : Promise.resolve(result);
  }
  end() { this.endCalls++; return this.drain ?? Promise.resolve(); }
  holdDrain() { this.drain = new Promise(resolve => { this.finishDrain = resolve; }); }
  getClientSnapshot() { return { queries: this.calls.length }; }
  getAcquireSnapshot() { return { count: this.calls.length }; }
}

type RuntimeModule = typeof import("@/db/client-runtime");
let modules: RuntimeModule[] = [];
const client = (runtime: RuntimeModule) => (runtime.db as unknown as { $client: FakePool }).$client;
async function loadModule() {
  vi.resetModules(); const runtime = await import("@/db/client-runtime");
  modules.push(runtime); return runtime;
}
beforeEach(() => {
  fake.pools = []; fake.drizzle.mockReset(); fake.capture.mockReset(); fake.log.mockReset(); modules = [];
  fake.drizzle.mockImplementation((pool: FakePool) => ({ $client: pool, execute: (...args: unknown[]) => pool.query(...args) }));
  vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture-password@127.0.0.1:5432/runtime_fixture?sslmode=disable");
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("VERCEL", ""); vi.stubEnv("RIVALHUB_RELEASE_COMMIT", "fixture-runtime-build");
});
afterEach(async () => {
  for (const pool of fake.pools) pool.finishDrain?.();
  await Promise.all(modules.map(module => module.disposeDatabaseBinding()));
  vi.unstubAllEnvs();
});

it("shares one pool/guard across independently evaluated modules but keeps Drizzle local", async () => {
  const a = await loadModule(), b = await loadModule();
  expect(a.getDatabasePoolSnapshot()).toBeNull();
  await Promise.all([a.db.execute("select a"), b.db.execute("select b")]);
  expect(fake.pools).toHaveLength(1);
  expect(fake.pools[0].listenerCount("error")).toBe(1);
  expect(fake.drizzle).toHaveBeenCalledTimes(2);
  expect(a.getDatabasePoolSnapshot()).toEqual(b.getDatabasePoolSnapshot());
  expect(a.getDatabasePoolSnapshot()).toMatchObject({ generation: 1, client: { queries: 2 } });
  expect(JSON.stringify(a.getDatabasePoolSnapshot())).not.toMatch(/fixture-password|identity|scope/);
});

it("singleflights two-module pre-connect recovery and ignores late events from the retired pool", async () => {
  const a = await loadModule(), b = await loadModule();
  const old = client(a); void client(b);
  old.holdDrain(); old.failures.push({ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" });
  const calls = [a.db.execute("select a"), b.db.execute("select b")];
  await vi.waitFor(() => expect(fake.pools).toHaveLength(2));
  const replacement = fake.pools[1];
  expect(old.endCalls).toBe(1); expect(replacement.listenerCount("error")).toBe(1);
  expect(a.getDatabasePoolSnapshot()?.generation).toBe(2);
  await b.db.execute("select while draining");
  old.emit("error", { code: "ECONNRESET" });
  expect(fake.pools).toHaveLength(2); expect(replacement.endCalls).toBe(0);
  old.finishDrain!(); await Promise.all(calls);
  expect(replacement.calls).toHaveLength(3);
  expect(fake.drizzle).toHaveBeenCalledTimes(3);
  await a.db.execute("select refreshed local ORM");
  expect(fake.drizzle).toHaveBeenCalledTimes(4);
  expect(fake.log.mock.calls.filter(([entry]) => entry.event === "db.pool.rebuilt")).toHaveLength(1);
});

it("recovers a new-generation failure without letting a retired event rebuild it", async () => {
  const a = await loadModule(); const old = client(a);
  old.holdDrain(); old.emit("error", { code: "ECONNRESET" });
  await vi.waitFor(() => expect(fake.pools).toHaveLength(2));
  fake.pools[1].emit("error", { code: "ECONNRESET" });
  old.emit("error", { code: "ECONNRESET" });
  expect(fake.pools).toHaveLength(2);
  old.finishDrain!(); await vi.waitFor(() => expect(fake.pools).toHaveLength(3));
  expect(fake.pools[2].endCalls).toBe(0);
  expect(a.getDatabasePoolSnapshot()?.generation).toBe(3);
});

it("re-reads same-scope credentials during recovery but never replays an unknown commit", async () => {
  const a = await loadModule(); const old = client(a);
  old.failures.push({ code: "ECONNREFUSED" });
  vi.stubEnv("DATABASE_URL", "postgresql://fixture:rotated-fixture-password@127.0.0.1:5432/runtime_fixture?sslmode=disable");
  await old.query("select known pre-connect failure");
  expect(fake.pools[1].options.connectionString).toContain("rotated-fixture-password");
  const b = await loadModule();
  const active = client(b);
  const unknown = { code: "ECONNRESET" }; active.failures.push(unknown);
  await expect(b.db.execute("insert unknown outcome")).rejects.toBe(unknown);
  await vi.waitFor(() => expect(fake.pools).toHaveLength(3));
  expect(active.calls).toHaveLength(2); // credential retry and this unknown statement
  expect(fake.pools[2].calls).toHaveLength(0);
  await a.db.execute("select future request");
  expect(fake.pools[2].calls).toHaveLength(1);
  expect(JSON.stringify(fake.log.mock.calls)).not.toContain("rotated-fixture-password");
});

it("recovers the actual retry pool after a pre-connect failure followed by an unknown outcome without replay", async () => {
  const a = await loadModule(); const old = client(a);
  old.holdDrain(); old.failures.push({ code: "ECONNREFUSED" });
  const pending = a.db.execute("insert retry with unknown outcome");
  void pending.catch(() => {});
  await vi.waitFor(() => expect(fake.pools).toHaveLength(2));
  const replacement = fake.pools[1];
  const unknown = { code: "ECONNRESET" }; replacement.failures.push(unknown);
  old.finishDrain!();
  await expect(pending).rejects.toBe(unknown);
  await vi.waitFor(() => expect(fake.pools).toHaveLength(3));
  expect(a.getDatabasePoolSnapshot()?.generation).toBe(3);
  expect(old.calls).toHaveLength(1); expect(replacement.calls).toHaveLength(1);
  expect(fake.pools[2].calls).toHaveLength(0);
  old.emit("error", unknown); replacement.emit("error", unknown);
  await Promise.resolve();
  expect(fake.pools).toHaveLength(3); expect(fake.pools[2].endCalls).toBe(0);
  await a.db.execute("select future request");
  expect(fake.pools[2].calls).toHaveLength(1);
});

it.each([
  ["database", "DATABASE_URL", "postgresql://fixture:fixture-password@127.0.0.1:5432/another_db"],
  ["role", "DATABASE_URL", "postgresql://another_role:fixture-password@127.0.0.1:5432/runtime_fixture"],
  ["credential", "DATABASE_URL", "postgresql://fixture:another-password@127.0.0.1:5432/runtime_fixture"],
  ["pool", "NEXT_RUNTIME", ""],
  ["build", "RIVALHUB_RELEASE_COMMIT", "another-build"],
])("does not reuse the active owner across a changed %s identity", async (_name, key, value) => {
  const a = await loadModule(); void client(a);
  vi.stubEnv(key, value); const b = await loadModule();
  expect(() => client(b)).toThrow("configuration changed");
  expect(fake.pools).toHaveLength(1);
});

it("validates preview/TLS before joining an existing owner and refuses cross-database recovery", async () => {
  const a = await loadModule(); const old = client(a);
  vi.stubEnv("VERCEL_ENV", "preview"); const b = await loadModule();
  expect(() => client(b)).toThrow("Preview DATABASE_URL");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture-password@127.0.0.1:5432/runtime_fixture?sslrootcert=override");
  expect(() => client(b)).toThrow("canonical TLS");
  vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture-password@127.0.0.1:5432/another_db");
  old.failures.push({ code: "ECONNREFUSED" });
  await expect(old.query("select old scope")).rejects.toThrow("scope changed");
  expect(fake.pools).toHaveLength(1); expect(old.endCalls).toBe(0);
});

it("preserves the callback channel without replay and disposes only the final module binding", async () => {
  const a = await loadModule(), b = await loadModule();
  const old = client(a); void client(b);
  const callback = vi.fn(); old.failures.push({ code: "ECONNREFUSED" });
  expect(old.query("callback query", callback)).toBeUndefined();
  await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  expect(fake.pools).toHaveLength(1);
  await a.disposeDatabaseBinding(); expect(old.endCalls).toBe(0);
  await b.disposeDatabaseBinding(); expect(old.endCalls).toBe(1);
  expect(b.getDatabasePoolSnapshot()).toBeNull();
  const c = await loadModule(); void client(c);
  old.emit("error", { code: "ECONNRESET" });
  await a.disposeDatabaseBinding();
  expect(fake.pools).toHaveLength(2); expect(fake.pools[1].endCalls).toBe(0);
});
