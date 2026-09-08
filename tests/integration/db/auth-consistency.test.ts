import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { resolveOrCreateCanonicalUserInTx } from "../../../src/lib/identity/canonical";
import { createLocalPool } from "./harness/database";

describe("Auth ↔ canonical user consistency PostgreSQL invariants", () => {
  it("rolls back a failed canonical write and lets a later login/confirmation retry converge once", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const authId = randomUUID();
    const email = `auth-retry-${authId}@local.test`;
    const verifiedAt = new Date("2026-09-08T10:00:00.000Z");
    const rollback = Symbol("canonical write failure");

    try {
      await expect(database.transaction(async (tx) => {
        await resolveOrCreateCanonicalUserInTx(tx, {
          authId,
          email,
          verifiedAt,
          source: "signup_confirmation",
          allowCreate: true,
        });
        throw rollback;
      })).rejects.toBe(rollback);

      await expect(pool.query("SELECT count(*)::int AS count FROM users WHERE auth_id = $1", [authId])).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(pool.query("SELECT count(*)::int AS count FROM user_identities WHERE provider_subject = $1", [authId])).resolves.toMatchObject({ rows: [{ count: 0 }] });

      const firstRetry = await database.transaction((tx) => resolveOrCreateCanonicalUserInTx(tx, {
        authId,
        email,
        verifiedAt,
        source: "signup_confirmation",
        allowCreate: true,
      }));
      const confirmationRetry = await database.transaction((tx) => resolveOrCreateCanonicalUserInTx(tx, {
        authId,
        email,
        verifiedAt: new Date("2026-09-08T10:05:00.000Z"),
        source: "signup_confirmation",
        allowCreate: true,
      }));

      expect(confirmationRetry.id).toBe(firstRetry.id);
      await expect(pool.query("SELECT count(*)::int AS count FROM users WHERE email = $1", [email])).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expect(pool.query("SELECT kind::text, user_id FROM user_identities WHERE normalized_value = $1 ORDER BY kind", [email])).resolves.toMatchObject({
        rows: [
          { kind: "auth", user_id: firstRetry.id },
          { kind: "email", user_id: firstRetry.id },
        ],
      });
    } finally {
      await pool.query("DELETE FROM user_identities WHERE provider_subject = $1", [authId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE auth_id = $1", [authId]).catch(() => {});
      await pool.end();
    }
  });

  it("refuses to bind an Auth result when email and Auth subject owners disagree", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const authId = randomUUID();
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    const email = `conflict-${authId}@local.test`;

    try {
      await pool.query(
        "INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)",
        [firstUserId, `first-${firstUserId}@local.test`, secondUserId, `second-${secondUserId}@local.test`],
      );
      await pool.query(
        `INSERT INTO user_identities
          (id, user_id, kind, provider, provider_subject, normalized_value, verified_at, provenance, is_primary)
         VALUES
          ($1, $2, 'auth', 'supabase_auth', $3, $4, now(), 'signup_confirmation', true),
          ($5, $6, 'email', 'email', $4, $4, now(), 'signup_confirmation', true)`,
        [randomUUID(), firstUserId, authId, email, randomUUID(), secondUserId],
      );

      await expect(database.transaction((tx) => resolveOrCreateCanonicalUserInTx(tx, {
        authId,
        email,
        verifiedAt: new Date("2026-09-08T10:00:00.000Z"),
        source: "admin_migration",
        allowCreate: true,
      }))).rejects.toThrow("Auth identity 与 email identity 指向不同 canonical user");

      await expect(pool.query("SELECT count(*)::int AS count FROM users WHERE email = $1", [email])).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await pool.query("DELETE FROM user_identities WHERE user_id = ANY($1::uuid[])", [[firstUserId, secondUserId]]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[firstUserId, secondUserId]]).catch(() => {});
      await pool.end();
    }
  });
});
