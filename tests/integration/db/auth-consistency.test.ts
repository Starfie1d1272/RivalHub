import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { createServiceClient } from "../../../src/lib/auth/supabase-server";
import { resolveOrCreateCanonicalUserInTx } from "../../../src/lib/identity/canonical";
import { createLocalPool } from "./harness/database";

const hasLocalSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
);

type AuditOutput = {
  records: Array<{
    classification: string;
    authUserId: string | null;
    canonicalUserId: string | null;
    healability: string;
    repairCode: string | null;
  }>;
  repair?: {
    action: string | null;
    executable: boolean;
    applied?: { canonicalUserId: string };
  };
};

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

  it("refuses a repair when a dry-run create plan finds a canonical owner before commit", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const authId = randomUUID();
    const email = `plan-drift-${authId}@local.test`;
    const ownerId = randomUUID();

    try {
      await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [ownerId, email]);

      await expect(database.transaction((tx) => resolveOrCreateCanonicalUserInTx(tx, {
        authId,
        email,
        verifiedAt: new Date("2026-09-08T10:00:00.000Z"),
        source: "admin_migration",
        allowCreate: true,
        expectedCanonicalUserId: null,
      }))).rejects.toThrow("canonical owner 与 dry-run plan 不一致");

      await expect(pool.query("SELECT count(*)::int AS count FROM user_identities WHERE provider_subject = $1", [authId])).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await pool.query("DELETE FROM user_identities WHERE user_id = $1", [ownerId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [ownerId]).catch(() => {});
      await pool.end();
    }
  });

  it.skipIf(!hasLocalSupabase)("runs a Local Supabase Auth orphan through audit, repair, and a second audit", async () => {
    const auth = createServiceClient();
    const pool = createLocalPool();
    const email = `audit-repair-${randomUUID()}@rivalhub.local`;
    const password = `Local-${randomUUID()}-pass`;
    let authId: string | undefined;

    try {
      const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) {
        throw new Error(`Local Auth orphan fixture 创建失败：${created.error?.message ?? "missing user"}`);
      }
      authId = created.data.user.id;

      const initial = runLocalAudit();
      expect(initial.records.find((record) => record.authUserId === authId)).toMatchObject({
        classification: "stale_auth_orphan",
        canonicalUserId: null,
        healability: "safe_self_heal",
        repairCode: "create_canonical_user",
      });

      const dryRun = runLocalAudit(["--repair-auth", authId]);
      expect(dryRun.repair).toMatchObject({ action: "create_canonical_user", executable: true });

      const applied = runLocalAudit(["--repair-auth", authId, "--apply"]);
      const canonicalUserId = applied.repair?.applied?.canonicalUserId;
      expect(canonicalUserId).toBeTruthy();

      const after = runLocalAudit();
      expect(after.records.find((record) => record.authUserId === authId)).toMatchObject({
        classification: "consistent",
        canonicalUserId: canonicalUserId,
      });
      await expect(pool.query(
        "SELECT kind::text, provider FROM user_identities WHERE user_id = $1 AND status = 'active' ORDER BY kind",
        [canonicalUserId],
      )).resolves.toMatchObject({
        rows: [
          { kind: "auth", provider: "supabase_auth" },
          { kind: "email", provider: "email" },
        ],
      });
    } finally {
      if (authId) {
        await pool.query("DELETE FROM user_identities WHERE user_id IN (SELECT id FROM users WHERE auth_id = $1)", [authId]).catch(() => {});
        await pool.query("DELETE FROM users WHERE auth_id = $1", [authId]).catch(() => {});
        await auth.auth.admin.deleteUser(authId).catch(() => {});
      }
      await pool.end();
    }
  });
});

function runLocalAudit(args: readonly string[] = []): AuditOutput {
  const executable = resolve(process.cwd(), `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);
  const output = execFileSync(executable, ["scripts/db/auth-consistency-runner.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  const marker = "{\n  \"mode\":";
  const start = output.lastIndexOf(marker);
  if (start < 0) throw new Error(`Auth consistency audit 未输出 JSON：${output.slice(-2000)}`);
  return JSON.parse(output.slice(start)) as AuditOutput;
}
