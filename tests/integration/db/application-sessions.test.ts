import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import {
  beginAuthentication, beginPasswordMutationInTx, finishPasswordMutationInTx,
  issueApplicationSessionInTx, readApplicationSession, revokeAllApplicationSessionsInTx, revokeApplicationSession,
} from "../../../src/lib/auth/session-registry";
import { revokeSecondaryEmailIdentityInTx } from "../../../src/lib/identity/linking";
import { createLocalPool } from "./harness/database";

async function fixture() {
  const pool = createLocalPool();
  const database = drizzle(pool, { schema });
  const userId = randomUUID();
  await pool.query("INSERT INTO users(id, email) VALUES ($1, $2)", [userId, `sessions-${userId}@local.test`]);
  return { pool, database, userId, cleanup: async () => { await pool.query("DELETE FROM users WHERE id=$1", [userId]); await pool.end(); } };
}

describe("application session PostgreSQL lifecycle", () => {
  it("revokes every session when a secondary credential is withdrawn", async () => {
    const f = await fixture();
    try {
      const identityId = randomUUID();
      await f.pool.query("INSERT INTO user_identities(id,user_id,kind,provider,provider_subject,normalized_value,verified_at,provenance) VALUES ($1,$2,'email','email',$3,$3,now(),'user_verified_link')", [identityId, f.userId, `secondary-${identityId}@local.test`]);
      const proof = await beginAuthentication(f.database);
      const a = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      const b = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      await f.pool.query("UPDATE user_identities SET is_primary=true WHERE id=$1", [identityId]);
      await expect(f.database.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, { userId: f.userId, identityId }))).rejects.toThrow();
      expect(await readApplicationSession(f.database, a, f.userId)).not.toBeNull();
      await f.pool.query("UPDATE user_identities SET is_primary=false WHERE id=$1", [identityId]);
      await f.database.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, { userId: f.userId, identityId }));
      expect(await readApplicationSession(f.database, a, f.userId)).toBeNull();
      expect(await readApplicationSession(f.database, b, f.userId)).toBeNull();
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await f.pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [f.userId]);
      await f.pool.query("DELETE FROM user_identities WHERE user_id=$1", [f.userId]);
      await f.cleanup();
    }
  });

  it("revokes only the logged-out session; expiry and all-session revocation reject saved ids", async () => {
    const f = await fixture();
    try {
      const proof = await beginAuthentication(f.database);
      const a = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      const b = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      await revokeApplicationSession(f.database, a);
      expect(await readApplicationSession(f.database, a, f.userId)).toBeNull();
      expect(await readApplicationSession(f.database, b, f.userId)).toMatchObject({ userId: f.userId });
      await f.pool.query("UPDATE application_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [b]);
      expect(await readApplicationSession(f.database, b, f.userId)).toBeNull();
      await f.database.transaction(tx => revokeAllApplicationSessionsInTx(tx, f.userId));
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const fresh = await beginAuthentication(f.database);
      expect(await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, fresh))).toBeTruthy();
    } finally { await f.cleanup(); }
  });

  it("serializes an in-flight issuance behind committed revocation and rejects its older proof", async () => {
    const f = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>(r => { locked = r; });
    const continueRevocation = new Promise<void>(r => { release = r; });
    try {
      const proof = await beginAuthentication(f.database);
      const revocation = f.database.transaction(async tx => {
        await revokeAllApplicationSessionsInTx(tx, f.userId);
        locked();
        await continueRevocation;
      });
      await ready;
      const issuance = f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      const denied = expect(issuance).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      release();
      await revocation;
      await denied;
    } finally { release?.(); await f.cleanup(); }
  });

  it("blocks issuance throughout password mutation and fences proofs started during the provider call", async () => {
    const f = await fixture();
    try {
      const proof = await beginAuthentication(f.database);
      const old = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      const mutation = await f.database.transaction(tx => beginPasswordMutationInTx(tx, f.userId, proof));
      expect(await readApplicationSession(f.database, old, f.userId)).toBeNull();
      const during = await beginAuthentication(f.database);
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, during))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, randomUUID()))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, mutation));
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, during))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const after = await beginAuthentication(f.database);
      expect(await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, after))).toBeTruthy();
    } finally { await f.cleanup(); }
  });
});
