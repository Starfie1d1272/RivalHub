import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { ErrorCode } from "../../../src/lib/errors";
import {
  changePrimarySteam64InTx,
  recordGameplaySteamIdentityInTx,
  resolveGameplayUserBySteam64,
  retireGameplaySteamIdentityInTx,
} from "../../../src/lib/identity/gameplay-steam";
import { upsertSteamProfile } from "../../../src/lib/steam-profiles";
import { createLocalPool } from "./harness/database";

describe("Steam identity foundation", () => {
  it("keeps a changed primary as a revocable historical gameplay identity", async () => {
    const pool = createLocalPool({ max: 2 });
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const oldSteam64 = "76561198000000001";
    const nextSteam64 = "76561198000000002";
    const alternateSteam64 = "76561198000000003";

    try {
      await database.insert(schema.users).values([
        { id: userId, email: `${userId}@steam-identity.local`, steam64: oldSteam64 },
        { id: otherUserId, email: `${otherUserId}@steam-identity.local`, steam64: "76561198000000004" },
      ]);
      await client.query(
        `UPDATE users
            SET steam_name = $1, steam_profile_url = $2, avatar_url = $3
          WHERE id = $4`,
        ["Legacy Old", "https://steamcommunity.com/profiles/old", "https://avatars.steamstatic.com/old.jpg", userId],
      );

      await database.transaction((tx) => changePrimarySteam64InTx(tx, {
        userId,
        nextSteam64,
        actorId: userId,
      }));

      const legacyAfterChange = await client.query<{
        steam_name: string | null;
        steam_profile_url: string | null;
        avatar_url: string | null;
      }>(`SELECT steam_name, steam_profile_url, avatar_url FROM users WHERE id = $1`, [userId]);
      expect(legacyAfterChange.rows[0]).toEqual({ steam_name: null, steam_profile_url: null, avatar_url: null });

      const [history] = await database.select().from(schema.userGameplaySteamIds)
        .where(and(
          eq(schema.userGameplaySteamIds.userId, userId),
          eq(schema.userGameplaySteamIds.steam64, oldSteam64),
        ));
      expect(history).toMatchObject({
        userId,
        steam64: oldSteam64,
        status: "active",
        provenance: "profile_change",
        confirmedByUserId: userId,
      });
      expect(history?.reason).toContain("保留历史游戏身份");

      await expect(database.transaction((tx) => changePrimarySteam64InTx(tx, {
        userId: otherUserId,
        nextSteam64: oldSteam64,
        actorId: otherUserId,
      }))).rejects.toMatchObject({ code: ErrorCode.STEAM_PROFILE_CONFLICT });

      expect(await resolveGameplayUserBySteam64(database, oldSteam64)).toEqual({
        userId,
        source: "gameplay_alias",
      });
      expect(await resolveGameplayUserBySteam64(database, nextSteam64)).toEqual({
        userId,
        source: "primary",
      });

      const firstAlternate = await database.transaction((tx) => recordGameplaySteamIdentityInTx(tx, {
        userId,
        steam64: alternateSteam64,
        actorId: userId,
        provenance: "admin_confirmed_alternate",
        reason: "管理员确认历史游戏身份。",
      }));
      const repeatedAlternate = await database.transaction((tx) => recordGameplaySteamIdentityInTx(tx, {
        userId,
        steam64: alternateSteam64,
        actorId: userId,
        provenance: "admin_confirmed_alternate",
        reason: "重复确认不应产生第二条 active 记录。",
      }));
      expect(firstAlternate).toMatchObject({ created: true });
      expect(repeatedAlternate).toEqual({ id: firstAlternate.id, created: false });

      await database.transaction((tx) => retireGameplaySteamIdentityInTx(tx, {
        identityId: history!.id,
        actorId: userId,
        reason: "撤销不再使用的历史身份。",
      }));
      const [retired] = await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.id, history!.id));
      expect(retired).toMatchObject({ status: "retired", retiredByUserId: userId });
      expect(await resolveGameplayUserBySteam64(database, oldSteam64)).toBeNull();
    } finally {
      await database.delete(schema.userGameplaySteamIds).where(eq(schema.userGameplaySteamIds.userId, userId));
      await database.delete(schema.users).where(eq(schema.users.id, otherUserId));
      await database.delete(schema.users).where(eq(schema.users.id, userId));
      client.release();
      await pool.end();
    }
  });

  it("uses excluded values on cache conflict and repairs the legacy rollback shadow", async () => {
    const pool = createLocalPool({ max: 1 });
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const userId = randomUUID();
    const steam64 = "76561198000000011";

    try {
      await database.insert(schema.users).values({
        id: userId,
        email: `${userId}@steam-profile.local`,
        steam64,
      });
      await client.query(
        `UPDATE users
            SET steam_name = $1, steam_profile_url = $2, avatar_url = $3
          WHERE id = $4`,
        ["Legacy name", "https://steamcommunity.com/profiles/legacy", "https://avatars.steamstatic.com/legacy.jpg", userId],
      );
      await database.insert(schema.steamProfiles).values({
        steam64,
        personaName: "Old official name",
        profileUrl: "https://steamcommunity.com/profiles/old",
        avatarUrl: "https://avatars.steamstatic.com/old.jpg",
      });

      await upsertSteamProfile(database, {
        steam64,
        personaName: "New official name",
        profileUrl: `https://steamcommunity.com/profiles/${steam64}`,
        avatarUrl: null,
      });

      const [profile] = await database.select().from(schema.steamProfiles).where(eq(schema.steamProfiles.steam64, steam64));
      const userResult = await client.query<{
        steam_name: string | null;
        steam_profile_url: string | null;
        avatar_url: string | null;
      }>(`SELECT steam_name, steam_profile_url, avatar_url FROM users WHERE id = $1`, [userId]);
      expect(profile).toMatchObject({
        steam64,
        personaName: "New official name",
        profileUrl: `https://steamcommunity.com/profiles/${steam64}`,
        avatarUrl: null,
      });
      expect(userResult.rows[0]).toEqual({
        steam_name: "New official name",
        steam_profile_url: `https://steamcommunity.com/profiles/${steam64}`,
        avatar_url: null,
      });
    } finally {
      await database.delete(schema.steamProfiles).where(eq(schema.steamProfiles.steam64, steam64));
      await database.delete(schema.users).where(eq(schema.users.id, userId));
      client.release();
      await pool.end();
    }
  });
});
