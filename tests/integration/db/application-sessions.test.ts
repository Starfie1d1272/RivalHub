import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "../../../src/db/client";
const mutationDatabase = vi.hoisted(() => ({ current: undefined as DB | undefined, afterCommitCause: undefined as Error | undefined }));
vi.mock("@/db/client", () => ({ db: { transaction: async (run: Parameters<DB["transaction"]>[0]) => {
  const result = await mutationDatabase.current!.transaction(run);
  if (mutationDatabase.afterCommitCause) {
    const cause = mutationDatabase.afterCommitCause;
    mutationDatabase.afterCommitCause = undefined;
    throw cause;
  }
  return result;
} } }));
import { mutatePassword } from "../../../src/lib/auth/password-mutation";
import { actionError } from "../../../src/lib/action-utils";
import * as schema from "../../../src/db/schema";
import {
  beginAuthentication, beginPasswordMutationInTx, finishPasswordMutationInTx,
  issueApplicationSessionInTx, readApplicationSession, revokeAllApplicationSessionsInTx, revokeApplicationSession,
} from "../../../src/lib/auth/session-registry";
import { resolveOrCreateCanonicalUserInTx } from "../../../src/lib/identity/canonical";
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
  // Inject a real PG audit write error AFTER finish cleared pending inside
  // the final transaction. The rollback must restore the committed fence.
  it.each(["succeeded", "rejected"] as const)("provider %s + final audit failure preserves fence across new requests", async (providerOutcome) => {
    const f = await fixture();
    mutationDatabase.current = f.database;
    const faultName = `password_fault_${f.userId.replaceAll("-", "")}`;
    try {
      const proof = await beginAuthentication(f.database);
      const oldSession = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      await f.pool.query(`CREATE FUNCTION ${faultName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-private-provider-body' USING ERRCODE='23514'; END $$`);
      await f.pool.query(`CREATE TRIGGER ${faultName} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.actor_id = '${f.userId}' AND NEW.action <> 'user.password_update_started') EXECUTE FUNCTION ${faultName}()`);
      const update = vi.fn(async () => ({ error: providerOutcome === "succeeded" ? null : { status: 422 } }));
      const failure = await mutatePassword(f.userId, proof, "user.reset_password", update).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        code: "PASSWORD_UPDATE_OUTCOME_UNKNOWN", outcome: "finalization_unknown", providerOutcome,
        cause: { cause: { code: "23514" } },
      });
      const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      try {
        const result = actionError("resetUserPassword", failure);
        const log = JSON.parse(String(write.mock.calls[0][0]));
        expect(log).toMatchObject({ errorClass: "database", retryable: false, exception: { code: "23514" }, safeContext: { outcome: "finalization_unknown", phase: "finalize", stage: providerOutcome } });
        expect(result).toMatchObject({ success: false, error: { requestId: log.requestId } });
        expect(JSON.stringify([log, result])).not.toContain("synthetic-private-provider-body");
      } finally { write.mockRestore(); }
      expect(update).toHaveBeenCalledOnce();
      expect(await readApplicationSession(f.database, oldSession, f.userId)).toBeNull();
      const pending = (await f.pool.query("SELECT password_mutation_id FROM application_session_controls WHERE user_id=$1", [f.userId])).rows[0].password_mutation_id;
      expect(pending).toBeTruthy();
      expect((await f.pool.query("SELECT action FROM audit_logs WHERE actor_id=$1", [f.userId])).rows).toEqual([{ action: "user.password_update_started" }]);
      // Fresh DB clock proofs model reload/new request; no client state involved.
      const fresh = await beginAuthentication(f.database);
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, fresh))).rejects.toMatchObject({ outcome: "pending" });
      await expect(mutatePassword(f.userId, fresh, "user.reset_password", update)).rejects.toMatchObject({ outcome: "pending" });
      expect(update).toHaveBeenCalledOnce();
      expect((await f.pool.query("SELECT password_mutation_id FROM application_session_controls WHERE user_id=$1", [f.userId])).rows[0].password_mutation_id).toBe(pending);
      await expect(f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, randomUUID()))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      mutationDatabase.current = undefined;
      await f.pool.query(`DROP TRIGGER IF EXISTS ${faultName} ON audit_logs`);
      await f.pool.query(`DROP FUNCTION IF EXISTS ${faultName}()`);
      await f.pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [f.userId]);
      await f.cleanup();
    }
  });
  it("does not assert a retained fence when a real final commit succeeded but acknowledgement was lost", async () => {
    const f = await fixture();
    mutationDatabase.current = f.database;
    try {
      const proof = await beginAuthentication(f.database);
      const cause = Object.assign(new Error("synthetic acknowledgement loss"), { code: "ECONNRESET" });
      const update = vi.fn(async () => {
        // Fault at the application adapter boundary AFTER an actual PG commit;
        // this models lost acknowledgement, not a network protocol experiment.
        mutationDatabase.afterCommitCause = cause;
        return { error: null };
      });
      const failure = await mutatePassword(f.userId, proof, "user.reset_password", update).catch((error: unknown) => error);
      expect(failure).toMatchObject({ outcome: "finalization_unknown", providerOutcome: "succeeded", cause, message: expect.stringContaining("登录恢复尚未确认") });
      expect((failure as Error).message).not.toContain("登录已暂停");
      expect(update).toHaveBeenCalledOnce();
      expect((await f.pool.query("SELECT password_mutation_id FROM application_session_controls WHERE user_id=$1", [f.userId])).rows[0].password_mutation_id).toBeNull();
      expect((await f.pool.query("SELECT action FROM audit_logs WHERE actor_id=$1 ORDER BY created_at", [f.userId])).rows).toEqual([{ action: "user.password_update_started" }, { action: "user.reset_password" }]);
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      mutationDatabase.afterCommitCause = undefined;
      mutationDatabase.current = undefined;
      await f.pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [f.userId]);
      await f.cleanup();
    }
  });
  // Existing registry tests never ran the password provider coordination owner.
  // Protect the committed fence and exact mutation reconciliation on real PG;
  // provider outcome is synthetic, no Auth account/password is created.
  it("real password owner retains unknown-outcome fence until exact-owner reconciliation", async () => {
    const f = await fixture();
    mutationDatabase.current = f.database;
    try {
      const proof = await beginAuthentication(f.database);
      const old = await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, proof));
      const cause = Object.assign(new Error("synthetic transport timeout"), { code: "ETIMEDOUT" });
      await expect(mutatePassword(f.userId, proof, "user.reset_password", async () => { throw cause; })).rejects.toMatchObject({ code: "PASSWORD_UPDATE_OUTCOME_UNKNOWN", cause });
      expect(await readApplicationSession(f.database, old, f.userId)).toBeNull();
      const pending = (await f.pool.query("SELECT password_mutation_id FROM application_session_controls WHERE user_id=$1", [f.userId])).rows[0].password_mutation_id;
      expect(pending).toBeTruthy();
      const during = await beginAuthentication(f.database);
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, during))).rejects.toMatchObject({ code: "PASSWORD_UPDATE_OUTCOME_UNKNOWN" });
      await expect(f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, randomUUID()))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect((await f.pool.query("SELECT action FROM audit_logs WHERE actor_id=$1", [f.userId])).rows).toEqual([{ action: "user.password_update_started" }]);
      // Internal owner reachability, NOT a deployed admin recovery entrypoint.
      await f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, pending));
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, during))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const after = await beginAuthentication(f.database);
      expect(await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, after))).toBeTruthy();
    } finally {
      mutationDatabase.current = undefined;
      await f.pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [f.userId]);
      await f.cleanup();
    }
  });
  it("rejects stale authentication before credential synchronization can recreate identity rows", async () => {
    const f = await fixture();
    try {
      const proof = await beginAuthentication(f.database);
      await f.database.transaction(tx => revokeAllApplicationSessionsInTx(tx, f.userId));
      await expect(f.database.transaction(tx => resolveOrCreateCanonicalUserInTx(tx, {
        authId: randomUUID(), email: `sessions-${f.userId}@local.test`, verifiedAt: new Date(),
        source: "signup_confirmation", allowCreate: false, authenticationStartedAt: proof,
      }))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect((await f.pool.query("SELECT id FROM user_identities WHERE user_id=$1", [f.userId])).rows).toEqual([]);
    } finally { await f.cleanup(); }
  });

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
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, during))).rejects.toMatchObject({ code: "PASSWORD_UPDATE_OUTCOME_UNKNOWN" });
      await expect(f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, randomUUID()))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await f.database.transaction(tx => finishPasswordMutationInTx(tx, f.userId, mutation));
      await expect(f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, during))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const after = await beginAuthentication(f.database);
      expect(await f.database.transaction(tx => issueApplicationSessionInTx(tx, f.userId, after))).toBeTruthy();
    } finally { await f.cleanup(); }
  });
});
