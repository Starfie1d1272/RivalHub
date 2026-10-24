import "server-only";
import { sql } from "drizzle-orm";
import { db, getDatabasePoolSnapshot } from "@/db/client";
import { mizarInstallations } from "@/db/schema";
import { logEvent } from "@/lib/observability/server";

/** Display-only touch, after the authority transaction has committed.
 * The database throttles writes across processes and its clock cannot regress.
 * No authority/match/source lock is ever acquired in this transaction.
 */
export async function touchMizarInstallation(installationId: string, competitionId: string): Promise<void> {
  try {
    // Display freshness must not queue behind domain work or open a connection.
    const pool = getDatabasePoolSnapshot();
    if (!pool || pool.idle === 0 || pool.waiting > 0) return;
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('lock_timeout', '25ms', true), set_config('statement_timeout', '250ms', true)`);
      await tx.execute(sql`UPDATE ${mizarInstallations}
        SET last_seen_at = GREATEST(last_seen_at, clock_timestamp())
        WHERE id = ${installationId} AND competition_id = ${competitionId} AND revoked_at IS NULL
          AND (last_seen_at IS NULL OR last_seen_at < clock_timestamp() - interval '30 seconds')`);
    });
  } catch {
    // A display failure must never turn a committed receipt into a failed write.
    logEvent({ level: "warn", event: "mizar.heartbeat.unavailable", scope: "match", operation: "heartbeat", retryable: false });
  }
}
