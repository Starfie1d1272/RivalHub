import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { userGameplaySteamIds, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export type GameplayIdentityExecutor = DB | TxDb;

export interface GameplayUserResolution {
  userId: string;
  source: "primary" | "gameplay_alias";
}

function isSteam64(value: string): boolean {
  return /^\d{17}$/.test(value);
}

function throwGameplayIdentityConflict(steam64: string): never {
  throw new AppError(
    ErrorCode.INTERNAL_ERROR,
    `Gameplay Steam64 ${steam64} 同时指向多个用户，已停止身份解析。`,
  );
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
    const ids = primaryBySteam.get(row.steam64) ?? [];
    ids.push(row.userId);
    primaryBySteam.set(row.steam64, ids);
  }
  const aliasesBySteam = new Map<string, string[]>();
  for (const row of aliasRows) {
    const ids = aliasesBySteam.get(row.steam64) ?? [];
    ids.push(row.userId);
    aliasesBySteam.set(row.steam64, ids);
  }

  const result = new Map<string, GameplayUserResolution>();
  for (const steam64 of values) {
    const primaryIds = primaryBySteam.get(steam64) ?? [];
    const aliasIds = aliasesBySteam.get(steam64) ?? [];
    const userIds = new Set([...primaryIds, ...aliasIds]);
    if (userIds.size > 1) throwGameplayIdentityConflict(steam64);
    const userId = [...userIds][0];
    if (!userId) continue;
    result.set(steam64, {
      userId,
      source: primaryIds.length > 0 ? "primary" : "gameplay_alias",
    });
  }
  return result;
}

export async function resolveGameplayUserBySteam64(
  database: GameplayIdentityExecutor,
  steam64: string,
): Promise<GameplayUserResolution | null> {
  return (await resolveGameplayUsersBySteam64(database, [steam64])).get(steam64) ?? null;
}
