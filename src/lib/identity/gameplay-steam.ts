import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { matchDemoImports, steamProfiles, userGameplaySteamIds, users } from "@/db/schema";
import { getDisplayName } from "@/lib/identity/display-name";
import { AppError, ErrorCode } from "@/lib/errors";

export type GameplayIdentityExecutor = DB | TxDb;

export interface GameplayUserResolution {
  userId: string;
  source: "primary" | "gameplay_alias";
}

export interface Steam64Conflict {
  userId: string;
  source: "primary" | "gameplay_alias";
}

export interface GameplaySteamIdentityInput {
  userId: string;
  steam64: string;
  actorId: string;
  provenance: "profile_change" | "admin_confirmed_alternate";
  sourceImportId?: string | null;
  reason: string;
}

const STEAM64_PATTERN = /^\d{17}$/;

function isSteam64(value: string): boolean {
  return STEAM64_PATTERN.test(value);
}

/**
 * Resolve an observed in-game Steam64 without treating it as a login fact.
 * A dirty cross-user mapping fails closed instead of choosing an arbitrary row.
 */
export async function resolveGameplayUsersBySteam64(
  database: GameplayIdentityExecutor,
  steam64Values: readonly string[],
): Promise<Map<string, GameplayUserResolution>> {
  const values = [...new Set(steam64Values.filter(isSteam64))];
  if (values.length === 0) return new Map();

  const [primaryRows, aliasRows] = await Promise.all([
    database.select({ steam64: users.steam64, userId: users.id })
      .from(users)
      .where(and(eq(users.status, "active"), inArray(users.steam64, values))),
    database.select({ steam64: userGameplaySteamIds.steam64, userId: userGameplaySteamIds.userId })
      .from(userGameplaySteamIds)
      .where(and(eq(userGameplaySteamIds.status, "active"), inArray(userGameplaySteamIds.steam64, values))),
  ]);

  const primaryBySteam = new Map<string, string[]>();
  for (const row of primaryRows) {
    if (!row.steam64) continue;
    primaryBySteam.set(row.steam64, [...(primaryBySteam.get(row.steam64) ?? []), row.userId]);
  }
  const aliasesBySteam = new Map<string, string[]>();
  for (const row of aliasRows) {
    aliasesBySteam.set(row.steam64, [...(aliasesBySteam.get(row.steam64) ?? []), row.userId]);
  }

  const result = new Map<string, GameplayUserResolution>();
  for (const steam64 of values) {
    const primaryIds = primaryBySteam.get(steam64) ?? [];
    const aliasIds = aliasesBySteam.get(steam64) ?? [];
    const userIds = new Set([...primaryIds, ...aliasIds]);
    if (userIds.size > 1) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `Gameplay Steam64 ${steam64} 同时指向多个用户，已停止身份解析。`);
    }
    const userId = [...userIds][0];
    if (!userId) continue;
    result.set(steam64, { userId, source: primaryIds.length > 0 ? "primary" : "gameplay_alias" });
  }
  return result;
}

export async function resolveGameplayUserBySteam64(
  database: GameplayIdentityExecutor,
  steam64: string,
): Promise<GameplayUserResolution | null> {
  return (await resolveGameplayUsersBySteam64(database, [steam64])).get(steam64) ?? null;
}

/**
 * Read the unified primary/observed-identity conflict surface. The caller only
 * receives whether another user owns the value; no other account is disclosed.
 */
export async function findSteam64Conflict(
  database: GameplayIdentityExecutor,
  steam64: string,
  excludeUserId?: string,
): Promise<Steam64Conflict | null> {
  if (!isSteam64(steam64)) return null;

  const [primaryRows, aliasRows] = await Promise.all([
    database.select({ userId: users.id })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.steam64, steam64))),
    database.select({ userId: userGameplaySteamIds.userId })
      .from(userGameplaySteamIds)
      .where(and(eq(userGameplaySteamIds.status, "active"), eq(userGameplaySteamIds.steam64, steam64))),
  ]);
  const ownUserIds = new Set<string>();
  for (const row of primaryRows) ownUserIds.add(row.userId);
  for (const row of aliasRows) ownUserIds.add(row.userId);
  if (excludeUserId) ownUserIds.delete(excludeUserId);
  const otherUserId = [...ownUserIds][0];
  if (!otherUserId) return null;
  return {
    userId: otherUserId,
    source: primaryRows.some((row) => row.userId === otherUserId) ? "primary" : "gameplay_alias",
  };
}

export async function assertSteam64Available(
  database: GameplayIdentityExecutor,
  steam64: string,
  excludeUserId?: string,
): Promise<void> {
  if (await findSteam64Conflict(database, steam64, excludeUserId)) {
    throw new AppError(ErrorCode.STEAM_PROFILE_CONFLICT, "该 Steam64 ID 已关联其他账户，请联系管理员处理。");
  }
}

async function lockSteam64(tx: TxDb, steam64: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`steam64:${steam64}`}, 0))`);
}

/**
 * Record an observed Steam64 as an active, auditable gameplay identity.
 * Repeating the same fact for the same user is idempotent; cross-user reuse
 * fails closed through the unified primary/alias conflict owner above.
 */
export async function recordGameplaySteamIdentityInTx(
  tx: TxDb,
  input: GameplaySteamIdentityInput,
): Promise<{ id: string; created: boolean }> {
  if (!isSteam64(input.steam64)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Steam64 ID 格式不正确（应为 17 位数字）");
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Steam 身份来源说明不能为空");
  }

  const [user] = await tx.select({ id: users.id, status: users.status, steam64: users.steam64 })
    .from(users)
    .where(eq(users.id, input.userId))
    .for("update");
  if (!user || user.status !== "active") {
    throw new AppError(ErrorCode.NOT_FOUND, "用户资料不存在");
  }
  if (user.steam64 === input.steam64 && input.provenance === "admin_confirmed_alternate") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "当前 Steam64 已是该用户的主身份");
  }

  await lockSteam64(tx, input.steam64);
  await assertSteam64Available(tx, input.steam64, input.userId);

  const [existing] = await tx.select({ id: userGameplaySteamIds.id })
    .from(userGameplaySteamIds)
    .where(and(
      eq(userGameplaySteamIds.userId, input.userId),
      eq(userGameplaySteamIds.steam64, input.steam64),
      eq(userGameplaySteamIds.status, "active"),
    ))
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  const [created] = await tx.insert(userGameplaySteamIds).values({
    userId: input.userId,
    steam64: input.steam64,
    status: "active",
    provenance: input.provenance,
    sourceImportId: input.sourceImportId ?? null,
    confirmedByUserId: input.actorId,
    confirmedAt: new Date(),
    reason,
  }).returning({ id: userGameplaySteamIds.id });
  if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "Steam 游戏身份保存失败");
  return { id: created.id, created: true };
}

/** Retire one gameplay identity without deleting its historical provenance. */
export async function retireGameplaySteamIdentityInTx(
  tx: TxDb,
  input: { identityId: string; actorId: string; reason: string },
): Promise<{ retired: boolean }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Steam 身份撤销原因不能为空");
  }
  const [identity] = await tx.select({
    id: userGameplaySteamIds.id,
    steam64: userGameplaySteamIds.steam64,
    status: userGameplaySteamIds.status,
  }).from(userGameplaySteamIds)
    .where(eq(userGameplaySteamIds.id, input.identityId))
    .for("update");
  if (!identity) throw new AppError(ErrorCode.NOT_FOUND, "Steam 游戏身份不存在");
  if (identity.status === "retired") return { retired: false };

  await lockSteam64(tx, identity.steam64);
  await tx.update(userGameplaySteamIds).set({
    status: "retired",
    retiredByUserId: input.actorId,
    retiredAt: new Date(),
    retiredReason: reason,
  }).where(and(
    eq(userGameplaySteamIds.id, input.identityId),
    eq(userGameplaySteamIds.status, "active"),
  ));
  return { retired: true };
}

/**
 * Change the current Steam64 and preserve the previous value as an auditable,
 * revocable gameplay identity. This is the single owner for primary changes;
 * Demo and admin product surfaces must consume it instead of reimplementing
 * resolver or uniqueness logic.
 */
export async function changePrimarySteam64InTx(
  tx: TxDb,
  input: { userId: string; nextSteam64: string | null; actorId: string },
): Promise<{ previousSteam64: string | null; steam64: string | null }> {
  if (input.nextSteam64 !== null && !isSteam64(input.nextSteam64)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Steam64 ID 格式不正确（应为 17 位数字）");
  }

  const [user] = await tx.select({ id: users.id, status: users.status, steam64: users.steam64 })
    .from(users)
    .where(eq(users.id, input.userId))
    .for("update");
  if (!user || user.status !== "active") {
    throw new AppError(ErrorCode.NOT_FOUND, "用户资料不存在");
  }

  const valuesToLock = [...new Set([user.steam64, input.nextSteam64].filter((value): value is string => value !== null))].sort();
  for (const steam64 of valuesToLock) await lockSteam64(tx, steam64);

  if (input.nextSteam64) {
    await assertSteam64Available(tx, input.nextSteam64, input.userId);
  }
  if (user.steam64 && user.steam64 !== input.nextSteam64) {
    const oldIdentityConflict = await findSteam64Conflict(tx, user.steam64, input.userId);
    if (oldIdentityConflict) {
      throw new AppError(ErrorCode.STEAM_PROFILE_CONFLICT, "该 Steam64 ID 已关联其他账户，请联系管理员处理。");
    }
  }

  const now = new Date();
  if (input.nextSteam64) {
    await tx.update(userGameplaySteamIds)
      .set({
        status: "retired",
        retiredByUserId: input.actorId,
        retiredAt: now,
        retiredReason: "该历史 Steam64 已恢复为当前 Steam64。",
      })
      .where(and(
        eq(userGameplaySteamIds.userId, input.userId),
        eq(userGameplaySteamIds.steam64, input.nextSteam64),
        eq(userGameplaySteamIds.status, "active"),
      ));
  }

  if (user.steam64 && user.steam64 !== input.nextSteam64) {
    const [existingHistory] = await tx.select({ id: userGameplaySteamIds.id })
      .from(userGameplaySteamIds)
      .where(and(
        eq(userGameplaySteamIds.userId, input.userId),
        eq(userGameplaySteamIds.steam64, user.steam64),
        eq(userGameplaySteamIds.status, "active"),
      ))
      .limit(1);
    if (!existingHistory) {
      await recordGameplaySteamIdentityInTx(tx, {
        userId: input.userId,
        steam64: user.steam64,
        provenance: "profile_change",
        actorId: input.actorId,
        reason: "用户更换当前 Steam64，保留历史游戏身份。",
      });
    }
  }

  if (user.steam64 !== input.nextSteam64) {
    await tx.execute(sql`
      UPDATE ${users}
         SET "steam_name" = NULL,
             "steam_profile_url" = NULL,
             "avatar_url" = NULL
       WHERE ${users.id} = ${input.userId}
    `);
  }

  await tx.update(users)
    .set({ steam64: input.nextSteam64, updatedAt: now })
    .where(eq(users.id, input.userId));
  return { previousSteam64: user.steam64, steam64: input.nextSteam64 };
}

/** Enrich canonical resolutions for an authorized operator; never resolve independently. */
export async function loadGameplayIdentityReviewDetails(
  database: GameplayIdentityExecutor,
  resolutions: ReadonlyMap<string, GameplayUserResolution>,
) {
  const userIds = [...new Set([...resolutions.values()].map((value) => value.userId))];
  if (userIds.length === 0) return new Map<string, GameplayIdentityReviewDetail>();
  const [players, aliases] = await Promise.all([
    database.select({ userId: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName })
      .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(inArray(users.id, userIds)),
    database.select({ identityId: userGameplaySteamIds.id, userId: userGameplaySteamIds.userId,
      steam64: userGameplaySteamIds.steam64, provenance: userGameplaySteamIds.provenance,
      status: userGameplaySteamIds.status, sourceSeasonId: matchDemoImports.seasonId })
      .from(userGameplaySteamIds).leftJoin(matchDemoImports, eq(matchDemoImports.id, userGameplaySteamIds.sourceImportId))
      .where(and(inArray(userGameplaySteamIds.steam64, [...resolutions.keys()]), eq(userGameplaySteamIds.status, "active"))),
  ]);
  return new Map([...resolutions].map(([steam64, resolution]) => {
    const player = players.find((row) => row.userId === resolution.userId);
    const alias = resolution.source === "gameplay_alias"
      ? aliases.find((row) => row.steam64 === steam64 && row.userId === resolution.userId) : undefined;
    return [steam64, { ...resolution, name: getDisplayName(player ?? {}), identity: alias ?? null }];
  }));
}

export interface GameplayIdentityReviewDetail extends GameplayUserResolution {
  name: string;
  identity: {
    identityId: string;
    provenance: "profile_change" | "admin_confirmed_alternate";
    status: "active" | "retired";
    sourceSeasonId: string | null;
  } | null;
}
