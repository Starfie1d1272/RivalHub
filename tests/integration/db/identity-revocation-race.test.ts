import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { beginAuthentication, issueApplicationSessionInTx, readApplicationSession } from "../../../src/lib/auth/session-registry";
import { resolveOrCreateCanonicalUserInTx } from "../../../src/lib/identity/canonical";
import { completeSecondaryIdentityLinkInTx, hashIdentityLinkState, revokeSecondaryEmailIdentityInTx } from "../../../src/lib/identity/linking";
import { createLocalPool } from "./harness/database";

async function fixture() {
  const pool = createLocalPool({ max: 3 });
  const a = await pool.connect();
  const b = await pool.connect();
  const dbA = drizzle(a, { schema });
  const dbB = drizzle(b, { schema });
  const userId = randomUUID(), identityId = randomUUID(), authId = randomUUID();
  const email = `secondary-${identityId}@local.test`;
  await a.query("INSERT INTO users(id,email) VALUES($1,$2)", [userId, `primary-${userId}@local.test`]);
  await a.query("INSERT INTO user_identities(id,user_id,kind,provider,provider_subject,normalized_value,verified_at,provenance) VALUES($1,$2,'email','email',$3,$3,now(),'user_verified_link'),($4,$2,'auth','supabase_auth',$5,$3,now(),'user_verified_link')", [identityId, userId, email, randomUUID(), authId]);
  const pidA = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  return {
    a, b, pool, dbA, dbB, userId, identityId, authId, email,
    login: (proof: string, hold?: () => Promise<void>) => dbB.transaction(async tx => {
      const user = await resolveOrCreateCanonicalUserInTx(tx, { authId, email, verifiedAt: new Date(), source: "existing_account_reverification", allowCreate: false, authenticationStartedAt: proof });
      const session = await issueApplicationSessionInTx(tx, user.id, proof);
      await hold?.();
      return session;
    }),
    // Observe the actual PostgreSQL wait graph: no guessed delay controls commit order.
    blocked: async (reverse = false) => {
      const [waiter, blocker] = reverse ? [pidA, pidB] : [pidB, pidA];
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const result = await pool.query("SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked", [waiter, blocker]);
        if (result.rows[0].blocked) return;
      }
      throw new Error("expected database lock barrier was not reached");
    },
    cleanup: async () => {
      await a.query("ROLLBACK"); await b.query("ROLLBACK");
      await a.query("DELETE FROM audit_logs WHERE actor_id=$1", [userId]);
      await a.query("DELETE FROM user_identities WHERE user_id=$1", [userId]);
      await a.query("DELETE FROM users WHERE id=$1", [userId]);
      a.release(); b.release(); await pool.end();
    },
  };
}

describe("secondary credential revocation versus login on independent PostgreSQL connections", () => {
  for (const proofTime of ["before", "during"] as const) {
    it(`rejects ${proofTime}-revocation proof after waiting for revocation commit`, async () => {
      const f = await fixture();
      try {
        const before = await beginAuthentication(f.dbB);
        await f.a.query("BEGIN");
        await revokeSecondaryEmailIdentityInTx(f.dbA as unknown as Parameters<typeof revokeSecondaryEmailIdentityInTx>[0], f);
        const proof = proofTime === "before" ? before : await beginAuthentication(f.dbB);
        const outcome = f.login(proof).then(sessionId => ({ sessionId, error: null }), error => ({ sessionId: null, error }));
        await f.blocked();
        await f.a.query("COMMIT");
        const result = await outcome;
        // Assert both invariants even on the vulnerable baseline.
        const active = (await f.a.query("SELECT id FROM user_identities WHERE user_id=$1 AND status='active'", [f.userId])).rows;
        const session = result.sessionId ? await readApplicationSession(f.dbA, result.sessionId, f.userId) : null;
        expect.soft(active).toEqual([]);
        expect.soft(session).toBeNull();
        expect(result.error).toMatchObject({ code: "UNAUTHORIZED" });
      } finally { await f.cleanup(); }
    });
  }
  it("allows login if the revocation rolls back", async () => {
    const f = await fixture();
    try {
      await f.a.query("BEGIN");
      await revokeSecondaryEmailIdentityInTx(f.dbA as unknown as Parameters<typeof revokeSecondaryEmailIdentityInTx>[0], f);
      const proof = await beginAuthentication(f.dbB);
      const login = f.login(proof);
      await f.blocked(); await f.a.query("ROLLBACK");
      expect(await readApplicationSession(f.dbA, await login, f.userId)).not.toBeNull();
    } finally { await f.cleanup(); }
  });
  it("rejects a proof started after committed revocation", async () => {
    const f = await fixture();
    try {
      await f.dbA.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, f));
      await expect(f.login(await beginAuthentication(f.dbB))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally { await f.cleanup(); }
  });
  it("allows normal login, and later revocation invalidates its session", async () => {
    const f = await fixture();
    try {
      const session = await f.login(await beginAuthentication(f.dbB));
      expect(await readApplicationSession(f.dbA, session, f.userId)).not.toBeNull();
      await f.dbA.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, f));
      expect(await readApplicationSession(f.dbA, session, f.userId)).toBeNull();
    } finally { await f.cleanup(); }
  });
  it("serializes revocation behind a login that commits first, then invalidates the issued session", async () => {
    const f = await fixture();
    let release!: () => void, issued!: () => void;
    const held = new Promise<void>(r => { release = r; });
    const ready = new Promise<void>(r => { issued = r; });
    try {
      const login = f.login(await beginAuthentication(f.dbB), async () => { issued(); await held; });
      await ready;
      const revoke = f.dbA.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, f));
      await f.blocked(true); release();
      const session = await login; await revoke;
      expect(await readApplicationSession(f.dbA, session, f.userId)).toBeNull();
      expect((await f.a.query("SELECT id FROM user_identities WHERE user_id=$1 AND status='active'", [f.userId])).rows).toEqual([]);
    } finally { release?.(); await f.cleanup(); }
  });

  for (const sameSubject of [true, false]) {
    it(`allows explicit relinking with a ${sameSubject ? "previous" : "new"} provider subject, but cancels pre-revoke requests`, async () => {
      const f = await fixture();
      const oldRequest = randomUUID(), newRequest = randomUUID(), token = randomUUID();
      const input = { currentUserId: f.userId, authId: sameSubject ? f.authId : randomUUID(), email: f.email, verifiedAt: new Date(), stateToken: token };
      const request = (id: string) => f.a.query("INSERT INTO identity_link_requests(id,user_id,normalized_email,state_token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')", [id, f.userId, f.email, hashIdentityLinkState(token + id)]);
      try {
        await request(oldRequest);
        await f.dbA.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, f));
        await expect(f.dbB.transaction(tx => completeSecondaryIdentityLinkInTx(tx, { ...input, requestId: oldRequest, stateToken: token + oldRequest }))).rejects.toThrow();
        await request(newRequest);
        const linkInput = { ...input, requestId: newRequest, stateToken: token + newRequest };
        expect(await f.dbB.transaction(tx => completeSecondaryIdentityLinkInTx(tx, linkInput))).toEqual({ kind: "linked" });
        await expect(f.dbB.transaction(tx => completeSecondaryIdentityLinkInTx(tx, linkInput))).rejects.toThrow();
        const proof = await beginAuthentication(f.dbB);
        const login = () => f.dbB.transaction(async tx => {
          const user = await resolveOrCreateCanonicalUserInTx(tx, { ...input, source: "existing_account_reverification", allowCreate: false, authenticationStartedAt: proof });
          return issueApplicationSessionInTx(tx, user.id, proof);
        });
        expect(await readApplicationSession(f.dbA, await login(), f.userId)).not.toBeNull();
        if (!sameSubject) await expect(f.login(proof)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      } finally { await f.cleanup(); }
    });
  }

  it("preserves new-account creation and serializes duplicate login requests", async () => {
    const f = await fixture();
    const authId = randomUUID(), email = `new-${authId}@local.test`;
    let createdId: string | undefined;
    try {
      const proof = await beginAuthentication(f.dbA);
      const input = { authId, email, verifiedAt: new Date(), source: "signup_confirmation" as const, allowCreate: true, authenticationStartedAt: proof };
      const results = await Promise.all([f.dbA.transaction(tx => resolveOrCreateCanonicalUserInTx(tx, input)), f.dbB.transaction(tx => resolveOrCreateCanonicalUserInTx(tx, input))]);
      createdId = results[0].id;
      expect(results[1].id).toBe(createdId);
      expect((await f.a.query("SELECT id FROM user_identities WHERE user_id=$1 AND status='active'", [createdId])).rows).toHaveLength(2);
    } finally {
      if (createdId) { await f.a.query("DELETE FROM user_identities WHERE user_id=$1", [createdId]); await f.a.query("DELETE FROM users WHERE id=$1", [createdId]); }
      await f.cleanup();
    }
  });

  for (const revokeFirst of [true, false]) {
    it(`serializes link and revoke with ${revokeFirst ? "revoke" : "link"} holding the user lock first`, async () => {
      const f = await fixture();
      const requestId = randomUUID(), stateToken = randomUUID();
      const input = { requestId, stateToken, currentUserId: f.userId, authId: f.authId, email: f.email, verifiedAt: new Date() };
      try {
        await f.a.query("INSERT INTO identity_link_requests(id,user_id,normalized_email,state_token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')", [requestId, f.userId, f.email, hashIdentityLinkState(stateToken)]);
        await f.a.query("BEGIN");
        const txA = f.dbA as unknown as Parameters<typeof revokeSecondaryEmailIdentityInTx>[0];
        if (revokeFirst) await revokeSecondaryEmailIdentityInTx(txA, f);
        else await completeSecondaryIdentityLinkInTx(txA, input);
        const pending = (revokeFirst
          ? f.dbB.transaction(tx => completeSecondaryIdentityLinkInTx(tx, input))
          : f.dbB.transaction(tx => revokeSecondaryEmailIdentityInTx(tx, f)))
          .then(() => null, error => error);
        await f.blocked(); await f.a.query("COMMIT");
        const error = await pending;
        if (revokeFirst) expect(error).toBeTruthy(); else expect(error).toBeNull();
        expect((await f.a.query("SELECT id FROM user_identities WHERE user_id=$1 AND status='active'", [f.userId])).rows).toEqual([]);
        await expect(f.login(await beginAuthentication(f.dbB))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      } finally { await f.cleanup(); }
    });
  }

});
