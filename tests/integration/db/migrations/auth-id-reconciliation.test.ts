import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const RECONCILIATION_MIGRATION = "0036_auth_id_reconciliation.sql";

async function replayBeforeReconciliation(client: Client): Promise<void> {
  for (const migration of migrationFiles((name) => name < RECONCILIATION_MIGRATION)) {
    await replayMigration(client, migration);
  }
}

async function ensureAuthUsersFixture(client: Client): Promise<void> {
  await client.query("CREATE SCHEMA IF NOT EXISTS auth");
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text
    )
  `);
}

async function runReconciliation(client: Client): Promise<void> {
  await replayMigration(client, RECONCILIATION_MIGRATION);
}

async function expectReconciliationFailure(client: Client, expectedCategory: string, privateValues: string[]): Promise<string> {
  try {
    await runReconciliation(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain(expectedCategory);
    for (const privateValue of privateValues) expect(message).not.toContain(privateValue);
    return message;
  }
  throw new Error("auth identity reconciliation should fail closed");
}

describe("auth identity reconciliation migration", () => {
  it("repairs a uniquely normalized email match, preserves valid mappings, and is idempotent", async () => {
    await withScratchDatabase("rivalhub_auth_id_repair", async (client) => {
      await replayBeforeReconciliation(client);
      await ensureAuthUsersFixture(client);

      const validAuthId = randomUUID();
      const repairedAuthId = randomUUID();
      const danglingAuthId = randomUUID();
      const validUserId = randomUUID();
      const danglingUserId = randomUUID();
      const validUpdatedAt = "2026-09-01T00:00:00.000Z";

      await client.query(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)",
        [validAuthId, "valid@example.test", repairedAuthId, "Player@Example.Test"],
      );
      await client.query(
        `INSERT INTO public.users (id, auth_id, email, updated_at)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $4)`,
        [
          validUserId,
          validAuthId,
          "valid@example.test",
          validUpdatedAt,
          danglingUserId,
          danglingAuthId,
          " player@example.test ",
        ],
      );

      await runReconciliation(client);

      const repaired = await client.query<{ auth_id: string; email: string; updated_at: Date }>(
        "SELECT auth_id, email, updated_at FROM public.users WHERE id = $1",
        [danglingUserId],
      );
      const valid = await client.query<{ auth_id: string; updated_at: Date }>(
        "SELECT auth_id, updated_at FROM public.users WHERE id = $1",
        [validUserId],
      );
      expect(repaired.rows[0]).toMatchObject({ auth_id: repairedAuthId, email: " player@example.test " });
      const repairedUpdatedAt = repaired.rows[0]?.updated_at;
      expect(repairedUpdatedAt).toBeInstanceOf(Date);
      expect(valid.rows[0]).toEqual({ auth_id: validAuthId, updated_at: new Date(validUpdatedAt) });

      await runReconciliation(client);
      const afterRerun = await client.query<{ auth_id: string; updated_at: Date }>(
        "SELECT auth_id, updated_at FROM public.users WHERE id = $1",
        [danglingUserId],
      );
      expect(afterRerun.rows[0]).toEqual({ auth_id: repairedAuthId, updated_at: repairedUpdatedAt });
    });
  });

  it("fails closed for an unmatched normalized email before changing the row", async () => {
    await withScratchDatabase("rivalhub_auth_id_unmatched", async (client) => {
      await replayBeforeReconciliation(client);
      await ensureAuthUsersFixture(client);

      const danglingAuthId = randomUUID();
      const userId = randomUUID();
      const email = `unmatched-${userId}@example.test`;
      await client.query(
        "INSERT INTO public.users (id, auth_id, email) VALUES ($1, $2, $3)",
        [userId, danglingAuthId, email],
      );

      await expectReconciliationFailure(client, "unmatched=1", [email, danglingAuthId]);
      const unchanged = await client.query<{ auth_id: string }>(
        "SELECT auth_id FROM public.users WHERE id = $1",
        [userId],
      );
      expect(unchanged.rows[0]?.auth_id).toBe(danglingAuthId);
    });
  });

  it("fails closed for an ambiguous normalized email match", async () => {
    await withScratchDatabase("rivalhub_auth_id_ambiguous", async (client) => {
      await replayBeforeReconciliation(client);
      await ensureAuthUsersFixture(client);

      const firstAuthId = randomUUID();
      const secondAuthId = randomUUID();
      const danglingAuthId = randomUUID();
      const userId = randomUUID();
      const email = `ambiguous-${userId}@example.test`;
      await client.query(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)",
        [firstAuthId, email.toUpperCase(), secondAuthId, ` ${email} `],
      );
      await client.query(
        "INSERT INTO public.users (id, auth_id, email) VALUES ($1, $2, $3)",
        [userId, danglingAuthId, email],
      );

      await expectReconciliationFailure(client, "ambiguous=1", [email, firstAuthId, secondAuthId, danglingAuthId]);
      const unchanged = await client.query<{ auth_id: string }>(
        "SELECT auth_id FROM public.users WHERE id = $1",
        [userId],
      );
      expect(unchanged.rows[0]?.auth_id).toBe(danglingAuthId);
    });
  });

  it("fails closed when multiple dangling rows resolve to one Auth target", async () => {
    await withScratchDatabase("rivalhub_auth_id_duplicate_target", async (client) => {
      await replayBeforeReconciliation(client);
      await ensureAuthUsersFixture(client);

      const matchedAuthId = randomUUID();
      const firstDanglingAuthId = randomUUID();
      const secondDanglingAuthId = randomUUID();
      const firstUserId = randomUUID();
      const secondUserId = randomUUID();
      const email = `duplicate-${firstUserId}@example.test`;
      await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [matchedAuthId, email]);
      await client.query(
        `INSERT INTO public.users (id, auth_id, email) VALUES
          ($1, $2, $3), ($4, $5, $6)`,
        [firstUserId, firstDanglingAuthId, email, secondUserId, secondDanglingAuthId, ` ${email} `],
      );

      await expectReconciliationFailure(client, "duplicate_targets=1", [email, matchedAuthId, firstDanglingAuthId, secondDanglingAuthId]);
    });
  });
});
