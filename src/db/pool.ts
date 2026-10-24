import { Pool, type PoolClient } from "pg";
import { logEvent } from "../lib/observability/logger";

type ConnectCallback = Parameters<Pool["connect"]>[0];

/** Covers both pool.query's callback checkout and Drizzle transaction checkout. */
export class DatabasePool extends Pool {
  connect(): Promise<PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const started = performance.now();
    const snapshot = { poolTotal: this.totalCount, poolIdle: this.idleCount, poolWaiting: this.waitingCount, poolMax: this.options.max };
    const connectionState = snapshot.poolIdle > 0 ? "reuse" : snapshot.poolTotal >= (snapshot.poolMax ?? 10) ? "queued" : "connect";
    const report = (error?: Error) => {
      const durationMs = performance.now() - started;
      if (!error && durationMs < 1000) return;
      try {
        logEvent({ level: "warn", event: "db.pool.acquire", scope: "database", operation: "pool.acquire", durationMs,
          safeContext: { ...snapshot, connectionState, outcome: error ? "failure" : "success" } });
      } catch { /* Diagnostics must preserve checkout and release semantics. */ }
    };
    if (callback) {
      super.connect((error, client, release) => { report(error); callback(error, client, release); });
      return;
    }
    return new Promise((resolve, reject) => {
      super.connect((error, client) => {
        report(error);
        if (error) reject(error);
        else resolve(client!);
      });
    });
  }
}
