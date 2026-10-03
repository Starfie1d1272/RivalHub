import "server-only";

import { sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";

/**
 * First lock for workflows that confirm Demo attribution or mutate its identity
 * dependencies. One exclusive gate avoids read→write lock upgrades during the
 * admin alias-confirmation flow. Public reads never take this lock.
 *
 * Lock order: identity gate → Demo map lineage / user / season → row locks.
 * Hold until commit so revocation either precedes validation, or invalidates
 * every confirmation that committed before it acquired the gate.
 */
export async function lockGameplayIdentityWriteInTx(tx: TxDb): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('gameplay-identity-write', 0))`);
}
