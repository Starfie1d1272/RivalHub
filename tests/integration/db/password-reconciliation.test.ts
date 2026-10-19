import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db/client";
const state = vi.hoisted(() => ({ database: undefined as DB | undefined, actorId: "", allowed: true }));
vi.mock("@/db/client", () => ({ db: {
  transaction: (run: Parameters<DB["transaction"]>[0]) => state.database!.transaction(run),
  select: (...args: unknown[]) => Reflect.apply(state.database!.select, state.database!, args),
} }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: async () => {
  if (!state.allowed) throw new Error("denied");
  return { userId: state.actorId };
} }));
import * as schema from "@/db/schema";
import { getPasswordReconciliationState, revokeUserSessions } from "@/actions/session-management";
import { beginAuthentication, beginPasswordMutationInTx, issueApplicationSessionInTx } from "@/lib/auth/session-registry";
import { createLocalPool } from "./harness/database";

// Recovery is security-sensitive: real transactions protect the exact fence,
// stale authentication proofs, rollback and competing recovery submissions.
describe("administrator password reconciliation", () => {
  it("requires scoped evidence, preserves newer fences, and atomically audits one recovery", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    state.database = database;
    const userId = randomUUID();
    state.actorId = randomUUID();
    await pool.query("INSERT INTO users(id,email) VALUES ($1,$2)", [userId, `reconcile-${userId}@local.test`]);
    try {
      const proof = await beginAuthentication(database);
      const mutationId = await database.transaction(tx => beginPasswordMutationInTx(tx, userId, proof));
      const reconciliation = { mutationId, outcome: "succeeded", evidenceSource: "provider_response_log", evidenceReference: "fixture-log-123", verified: true };
      state.allowed = false;
      expect((await getPasswordReconciliationState(userId)).success).toBe(false);
      expect((await revokeUserSessions({ userId, reconciliation })).success).toBe(false);
      state.allowed = true;
      expect(await getPasswordReconciliationState(userId)).toEqual({ success: true, data: { mutationId } });
      expect((await revokeUserSessions({ userId, providerMutationSettled: true })).success).toBe(false);
      expect((await revokeUserSessions({ userId, reconciliation: { ...reconciliation, evidenceReference: "https://secret?token=private" } })).success).toBe(false);
      expect((await revokeUserSessions({ userId, reconciliation: { ...reconciliation, outcome: "unknown" } })).success).toBe(false);
      expect((await revokeUserSessions({ userId, reconciliation: { ...reconciliation, mutationId: randomUUID() } })).success).toBe(false);
      expect((await revokeUserSessions({ userId })).success).toBe(true);
      expect(await getPasswordReconciliationState(userId)).toEqual({ success: true, data: { mutationId } });
      const staleProof = await beginAuthentication(database);
      const results = await Promise.all([
        revokeUserSessions({ userId, reconciliation }), revokeUserSessions({ userId, reconciliation }),
      ]);
      expect(results.filter(result => result.success)).toHaveLength(1);
      expect(await getPasswordReconciliationState(userId)).toEqual({ success: true, data: { mutationId: null } });
      await expect(database.transaction(tx => issueApplicationSessionInTx(tx, userId, staleProof))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const fresh = await beginAuthentication(database);
      await expect(database.transaction(tx => issueApplicationSessionInTx(tx, userId, fresh))).resolves.toBeTruthy();
      const audits = await pool.query("SELECT meta FROM audit_logs WHERE actor_id=$1 AND meta->'reconciliation'->>'mutationId'=$2", [state.actorId, mutationId]);
      expect(audits.rows).toEqual([{ meta: { reconciliation } }]);
      const nextProof = await beginAuthentication(database);
      const nextId = await database.transaction(tx => beginPasswordMutationInTx(tx, userId, nextProof));
      expect((await revokeUserSessions({ userId, reconciliation })).success).toBe(false);
      expect(await getPasswordReconciliationState(userId)).toEqual({ success: true, data: { mutationId: nextId } });
      const trigger = `reconcile_${userId.replaceAll("-", "")}`;
      await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$`);
      await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.actor_id = '${state.actorId}') EXECUTE FUNCTION ${trigger}()`);
      try {
        expect((await revokeUserSessions({ userId, reconciliation: { ...reconciliation, mutationId: nextId, outcome: "rejected" } })).success).toBe(false);
        expect(await getPasswordReconciliationState(userId)).toEqual({ success: true, data: { mutationId: nextId } });
      } finally {
        await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
        await pool.query(`DROP FUNCTION ${trigger}()`);
      }
    } finally {
      state.allowed = true;
      await pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [state.actorId]);
      await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      await pool.end();
      state.database = undefined;
    }
  });
});
