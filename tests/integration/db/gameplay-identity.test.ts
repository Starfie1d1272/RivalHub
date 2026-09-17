import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { resolveGameplayUserBySteam64 } from "../../../src/lib/identity/gameplay-steam";
import {
  GAMEPLAY_STEAM_CONFLICT_MESSAGE,
  ensureGameplaySteamIdentityInTx,
} from "../../../src/lib/demo-integration/review";
import { AppError, ErrorCode } from "../../../src/lib/errors";
import { capturePostgresError, createLocalPool } from "./harness/database";

describe("gameplay Steam identity PostgreSQL integration", () => {
  it("keeps primary identity separate, makes aliases idempotent, and fails closed on conflicts", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const userA = randomUUID();
    const userB = randomUUID();
    const primaryA = "76561198000000001";
    const aliasA = "76561198000000002";
    const primaryB = "76561198000000003";
    try {
      await database.insert(schema.users).values([
        { id: userA, email: `${userA}@local.test`, steam64: primaryA },
        { id: userB, email: `${userB}@local.test`, steam64: primaryB },
      ]);

      const primaryResolution = await resolveGameplayUserBySteam64(database, primaryA);
      expect(primaryResolution).toEqual({ userId: userA, source: "primary" });
      await expect(resolveGameplayUserBySteam64(database, "76561198000000004")).resolves.toBeNull();

      const primaryNoop = await database.transaction((tx) => ensureGameplaySteamIdentityInTx(tx, {
        userId: userA,
        steam64: primaryA,
        sourceImportId: null,
        confirmedByUserId: userA,
      }));
      expect(primaryNoop).toEqual({ aliasId: null, created: false });

      const firstAlias = await database.transaction((tx) => ensureGameplaySteamIdentityInTx(tx, {
        userId: userA,
        steam64: aliasA,
        sourceImportId: null,
        confirmedByUserId: userA,
      }));
      const secondAlias = await database.transaction((tx) => ensureGameplaySteamIdentityInTx(tx, {
        userId: userA,
        steam64: aliasA,
        sourceImportId: null,
        confirmedByUserId: userA,
      }));
      expect(firstAlias.created).toBe(true);
      expect(secondAlias).toEqual({ aliasId: firstAlias.aliasId, created: false });
      await expect(resolveGameplayUserBySteam64(database, aliasA)).resolves.toEqual({ userId: userA, source: "gameplay_alias" });

      await client.query("BEGIN");
      const duplicateAliasError = await capturePostgresError(client, () =>
        database.insert(schema.userGameplaySteamIds).values({
          userId: userB,
          steam64: aliasA,
          confirmedByUserId: userB,
          reason: "duplicate active alias test",
        }),
      );
      await client.query("ROLLBACK");
      expect(duplicateAliasError).toMatchObject({ cause: { code: "23505" } });

      await expect(database.transaction((tx) => ensureGameplaySteamIdentityInTx(tx, {
        userId: userA,
        steam64: primaryB,
        sourceImportId: null,
        confirmedByUserId: userA,
      }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, message: GAMEPLAY_STEAM_CONFLICT_MESSAGE });

      await database.update(schema.userGameplaySteamIds).set({
        status: "retired",
        retiredByUserId: userA,
        retiredAt: new Date(),
        retiredReason: "retired resolver test",
      }).where(and(eq(schema.userGameplaySteamIds.userId, userA), eq(schema.userGameplaySteamIds.steam64, aliasA)));
      await expect(resolveGameplayUserBySteam64(database, aliasA)).resolves.toBeNull();

      await database.insert(schema.userGameplaySteamIds).values({
        userId: userA,
        steam64: primaryB,
        confirmedByUserId: userA,
        reason: "dirty cross-user conflict test",
      }).catch(() => undefined);
      await expect(resolveGameplayUserBySteam64(database, primaryB)).rejects.toBeInstanceOf(AppError);
    } finally {
      await client.query("DELETE FROM user_gameplay_steam_ids WHERE user_id = ANY($1::uuid[])", [[userA, userB]]).catch(() => {});
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]).catch(() => {});
      client.release();
      await pool.end();
    }
  });
});
