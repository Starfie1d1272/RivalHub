import { Pool, type PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { observeDbStream } from "../lib/observability/db-traffic";
import { logEvent } from "../lib/observability/logger";
import { preparePgTraffic } from "../lib/observability/pg-traffic-adapter";

import { createClientMeasurements, measureClient } from "./client-measurement";

type ConnectCallback = Parameters<Pool["connect"]>[0];

/** Covers both pool.query's callback checkout and Drizzle transaction checkout. */
export class DatabasePool extends Pool {
  private readonly clientMeasurements = createClientMeasurements();
  constructor(options: ConstructorParameters<typeof Pool>[0]) {
    super(options);
    // Preserve pg-pool's selected constructor, including custom clients and
    // their prototype, constructor identity, arguments and new.target.
    try {
      const internals = this as unknown as { Client: new (...args: never[]) => PoolClient };
      internals.Client = new Proxy(internals.Client, {
        construct(target, args) {
          const client = Reflect.construct(target, args, target) as PoolClient;
          try { preparePgTraffic(client); } catch { /* Observation must not affect connection setup. */ }
          return client;
        },
      });
    } catch { /* A nonstandard Client must retain its original behavior. */ }
    this.on("connect", client => {
      try { observeDbStream(client); } catch { /* Measurement must not affect a connection. */ }
    });
  }
  getClientSnapshot() { return { ...this.clientMeasurements, holdBuckets: [...this.clientMeasurements.holdBuckets] }; }

  private readonly acquire = {
    count: 0, failures: 0, totalMs: 0, maxMs: 0, waitingPeak: 0, waitingTotal: 0, waitingSamples: 0, waitingBuckets: [0, 0, 0, 0, 0],
    states: { reuse: 0, connect: 0, queued: 0 },
    // Non-cumulative buckets: <=1, <=10, <=100, <=1000, >1000 ms.
    buckets: [0, 0, 0, 0, 0],
  };

  /** Complete process-local denominator, including fast and failed checkouts. */
  getAcquireSnapshot() {
    return { ...this.acquire, states: { ...this.acquire.states }, buckets: [...this.acquire.buckets], waitingBuckets: [...this.acquire.waitingBuckets] };
  }

  connect(): Promise<PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const runInContext = AsyncLocalStorage.snapshot();
    const started = performance.now();
    const snapshot = { poolTotal: this.totalCount, poolIdle: this.idleCount, poolWaiting: this.waitingCount, poolMax: this.options.max };
    const connectionState = snapshot.poolIdle > 0 ? "reuse" : snapshot.poolTotal >= (snapshot.poolMax ?? 10) ? "queued" : "connect";
    const waiting = snapshot.poolWaiting + (connectionState === "queued" ? 1 : 0);
    this.acquire.waitingPeak = Math.max(this.acquire.waitingPeak, waiting);
    this.acquire.waitingTotal += waiting;
    this.acquire.waitingSamples++;
    this.acquire.waitingBuckets[waiting === 0 ? 0 : waiting === 1 ? 1 : waiting <= 4 ? 2 : waiting <= 10 ? 3 : 4]++;
    const report = (error?: Error) => {
      const durationMs = performance.now() - started;
      this.acquire.count++;
      this.acquire.failures += error ? 1 : 0;
      this.acquire.totalMs += durationMs;
      this.acquire.maxMs = Math.max(this.acquire.maxMs, durationMs);
      this.acquire.states[connectionState]++;
      this.acquire.buckets[durationMs <= 1 ? 0 : durationMs <= 10 ? 1 : durationMs <= 100 ? 2 : durationMs <= 1000 ? 3 : 4]++;
      if (!error && durationMs < 1000) return;
      try {
        logEvent({ level: "warn", event: "db.pool.acquire", scope: "database", operation: "pool.acquire", durationMs,
          safeContext: { ...snapshot, connectionState, outcome: error ? "failure" : "success" } });
      } catch { /* Diagnostics must preserve checkout and release semantics. */ }
    };
    if (callback) {
      super.connect((error, client, release) => runInContext(() => { report(error); callback(error, client, !error && client ? measureClient(client, this.clientMeasurements) : release); }));
      return;
    }
    return new Promise((resolve, reject) => {
      super.connect((error, client) => {
        report(error);
        if (error) reject(error);
        else { measureClient(client!, this.clientMeasurements); resolve(client!); }
      });
    });
  }
}
