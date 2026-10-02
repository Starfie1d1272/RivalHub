import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  construct: vi.fn(),
  captureException: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class extends EventEmitter {
    query = mocks.query;
    end = vi.fn().mockResolvedValue(undefined);
    constructor() {
      super();
      mocks.construct();
    }
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: (pool: unknown) => ({ $client: pool }) }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/lib/runtime/preview", () => ({ assertPreviewDatabaseUrl: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({
  captureException: mocks.captureException,
  logEvent: mocks.logEvent,
}));
vi.mock("@/lib/observability/tracing", () => ({
  traceOperation: (_name: string, _options: unknown, callback: () => unknown) => callback(),
}));

const connectionError = Object.assign(new Error("connection unavailable"), { code: "ECONNREFUSED" });

// The Drizzle mock exposes its pool so these tests exercise the real runtime guard.
async function getPool(): Promise<Pool> {
  const { db } = await import("@/db/client-runtime");
  return (db as unknown as { $client: Pool }).$client;
}

describe("database final-failure telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records a recovered retry without emitting a final failure", async () => {
    mocks.query.mockRejectedValueOnce(connectionError).mockResolvedValueOnce({ rows: [] });
    const pool = await getPool();
    await expect(pool.query("select 1")).resolves.toEqual({ rows: [] });
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "db.query.retry" }));
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it.each([
    [connectionError, true, 2],
    [Object.assign(new Error("invalid SQL"), { code: "42601" }), false, 1],
  ])("classifies final query failure without treating SQL errors as connectivity", async (error, retryable, attempts) => {
    mocks.query.mockRejectedValue(error);
    const pool = await getPool();
    await expect(pool.query("select 1")).rejects.toBe(error);
    expect(mocks.query).toHaveBeenCalledTimes(attempts);
    expect(mocks.captureException).toHaveBeenCalledExactlyOnceWith("db.query.failure", error,
      expect.objectContaining({ errorClass: "database", retryable }));
  });

  it("records query-triggered rebuild failure once and preserves the rejection", async () => {
    const rebuildError = new Error("pool creation failed");
    mocks.construct.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw rebuildError; });
    mocks.query.mockRejectedValue(connectionError);
    const pool = await getPool();
    await expect(pool.query("select 1")).rejects.toBe(rebuildError);
    expect(mocks.captureException).toHaveBeenCalledExactlyOnceWith("db.pool.rebuild_failure", rebuildError,
      expect.objectContaining({ errorClass: "database", retryable: true }));
  });

  it("shares the rebuild failure event across concurrent pool errors", async () => {
    const rebuildError = new Error("pool creation failed");
    mocks.construct.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw rebuildError; });
    const pool = await getPool();
    pool.emit("error", connectionError);
    pool.emit("error", connectionError);
    await vi.waitFor(() => expect(mocks.captureException.mock.calls.filter(([event]) =>
      event === "db.pool.rebuild_failure")).toHaveLength(1));
    expect(mocks.construct).toHaveBeenCalledTimes(2);
  });
});
