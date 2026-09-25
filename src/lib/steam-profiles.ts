import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { DB, TxDb } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { getSteamPlayerSummaries, type SteamProfileSummary } from "@/lib/steam";
import { AppError, ErrorCode } from "@/lib/errors";
import { revalidatePublicPlayerTag } from "@/lib/revalidation";

type SteamProfileDatabase = DB | TxDb;

export type SteamProfileLookupResult =
  | { status: "ok"; profile: SteamProfileSummary }
  | { status: "not_found"; diagnosticUrl: string }
  | { status: "unavailable" }
  | { status: "conflict" };

export function steamProfileDiagnosticUrl(steam64: string): string {
  return `https://steamcommunity.com/profiles/${steam64}`;
}

export async function loadSteamProfilesBySteam64(
  database: SteamProfileDatabase,
  steam64Values: readonly string[],
): Promise<Map<string, SteamProfileSummary>> {
  const values = [...new Set(steam64Values.filter((value) => /^\d{17}$/.test(value)))];
  if (values.length === 0) return new Map();
  const rows = await database.select({
    steam64: steamProfiles.steam64,
    personaName: steamProfiles.personaName,
    profileUrl: steamProfiles.profileUrl,
    avatarUrl: steamProfiles.avatarUrl,
  }).from(steamProfiles).where(inArray(steamProfiles.steam64, values));
  return new Map(rows.flatMap((row) => row.personaName && row.profileUrl
    ? [[row.steam64, {
        steam64: row.steam64,
        personaName: row.personaName,
        profileUrl: row.profileUrl,
        avatarUrl: row.avatarUrl ?? null,
      } satisfies SteamProfileSummary]]
    : []));
}

export async function loadSteamProfile(
  database: SteamProfileDatabase,
  steam64: string,
): Promise<SteamProfileSummary | null> {
  return (await loadSteamProfilesBySteam64(database, [steam64])).get(steam64) ?? null;
}

export async function upsertSteamProfile(
  database: SteamProfileDatabase,
  profile: SteamProfileSummary,
): Promise<void> {
  const fetchedAt = new Date();
  await database.insert(steamProfiles).values({
    steam64: profile.steam64,
    personaName: profile.personaName,
    profileUrl: profile.profileUrl,
    avatarUrl: profile.avatarUrl,
    fetchedAt,
  }).onConflictDoUpdate({
    target: steamProfiles.steam64,
    set: {
      personaName: sql`excluded.persona_name`,
      profileUrl: sql`excluded.profile_url`,
      avatarUrl: sql`excluded.avatar_url`,
      fetchedAt: sql`excluded.fetched_at`,
    },
  });
}

/**
 * Server-only cache-miss owner for operator paths (such as Demo review):
 * 1. Read existing steam_profiles from the database.
 * 2. For missing Steam64 values only, batch-fetch from Steam GetPlayerSummaries.
 * 3. Upsert successfully retrieved profiles into steam_profiles.
 * 4. Provider failure or missing profiles degrade gracefully (return what is available, never throw).
 *
 * Never call on public render critical paths.
 * Does NOT register Steam64s into periodic current-primary refresh.
 */
export async function loadOrFetchSteamProfiles(
  database: SteamProfileDatabase,
  steam64Values: readonly string[],
): Promise<Map<string, SteamProfileSummary>> {
  const values = [...new Set(steam64Values.filter((value) => /^\d{17}$/.test(value)))];
  if (values.length === 0) return new Map();

  let cached = new Map<string, SteamProfileSummary>();
  try {
    if (typeof database?.select === "function") {
      cached = await loadSteamProfilesBySteam64(database, values);
    }
  } catch {
    // Graceful degrade: ignore read errors
  }

  const missing = values.filter((steam64) => !cached.has(steam64));
  if (missing.length === 0) return cached;

  try {
    const result = await getSteamPlayerSummaries(missing);
    if (result.status === "ok" && result.profiles.size > 0) {
      const fetchedProfiles = [...result.profiles.values()];
      for (const profile of fetchedProfiles) {
        cached.set(profile.steam64, profile);
      }
      if (typeof database?.insert === "function") {
        const fetchedAt = new Date();
        try {
          await database.insert(steamProfiles).values(fetchedProfiles.map((p) => ({
            steam64: p.steam64,
            personaName: p.personaName,
            profileUrl: p.profileUrl,
            avatarUrl: p.avatarUrl,
            fetchedAt,
          }))).onConflictDoUpdate({
            target: steamProfiles.steam64,
            set: {
              personaName: sql`excluded.persona_name`,
              profileUrl: sql`excluded.profile_url`,
              avatarUrl: sql`excluded.avatar_url`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          });
        } catch {
          // Graceful degrade: cache write failure does not fail review
        }
      }
    }
  } catch {
    // Provider failure graceful degrade: do not block operator review
  }

  return cached;
}

/** Query the provider and cache one profile for an explicit user action. */
export async function lookupAndCacheSteamProfile(
  database: SteamProfileDatabase,
  steam64: string,
): Promise<SteamProfileLookupResult> {
  const result = await getSteamPlayerSummaries([steam64]);
  if (result.status !== "ok") return { status: "unavailable" };
  const profile = result.profiles.get(steam64);
  if (!profile) return { status: "not_found", diagnosticUrl: steamProfileDiagnosticUrl(steam64) };
  await upsertSteamProfile(database, profile);
  return { status: "ok", profile };
}

/**
 * A new or changed primary must have a provider-confirmed profile before the
 * user transaction commits. An unchanged primary can use its existing cache.
 */
export async function getSteamProfileForPrimary(
  database: SteamProfileDatabase,
  currentSteam64: string | null,
  nextSteam64: string,
): Promise<SteamProfileSummary> {
  if (currentSteam64 === nextSteam64) {
    const cached = await loadSteamProfile(database, nextSteam64);
    if (cached) return cached;
  }
  const result = await getSteamPlayerSummaries([nextSteam64]);
  if (result.status !== "ok") throw new AppError(ErrorCode.STEAM_PROVIDER_UNAVAILABLE, "暂时无法连接 Steam，请稍后重试。", { providerStatus: result.status });
  const profile = result.profiles.get(nextSteam64);
  if (!profile) throw new AppError(ErrorCode.STEAM_PROFILE_NOT_FOUND, "未找到该 Steam 账号，请检查 Steam64 ID 是否填写正确。", { diagnosticUrl: steamProfileDiagnosticUrl(nextSteam64) });
  return profile;
}

export async function refreshSteamProfiles() {
  const candidates = await db.select({ id: users.id, steam64: users.steam64 }).from(users)
    .where(and(eq(users.status, "active"), isNotNull(users.steam64)));
  const steam64s = [...new Set(candidates.map((user) => user.steam64).filter((value): value is string => value !== null))];
  if (steam64s.length === 0) return { processed: 0, updated: 0, unresolved: 0 };

  const result = await getSteamPlayerSummaries(steam64s);
  if (result.status !== "ok") throw new Error(result.status === "unconfigured" ? "STEAM_PROFILE_UNCONFIGURED" : "STEAM_PROFILE_PROVIDER_FAILED");

  const cached = await loadSteamProfilesBySteam64(db, steam64s);
  const changedProfiles: SteamProfileSummary[] = [];
  const changedSteam64s = new Set<string>();
  let unresolved = 0;
  for (const steam64 of steam64s) {
    const profile = result.profiles.get(steam64);
    if (!profile) {
      unresolved += 1;
      continue;
    }
    const previous = cached.get(steam64);
    if (previous?.personaName === profile.personaName && previous.profileUrl === profile.profileUrl && previous.avatarUrl === profile.avatarUrl) continue;
    changedProfiles.push(profile);
    changedSteam64s.add(steam64);
  }

  if (changedProfiles.length > 0) {
    const fetchedAt = new Date();
    await db.insert(steamProfiles).values(changedProfiles.map((profile) => ({
      steam64: profile.steam64,
      personaName: profile.personaName,
      profileUrl: profile.profileUrl,
      avatarUrl: profile.avatarUrl,
      fetchedAt,
    }))).onConflictDoUpdate({
      target: steamProfiles.steam64,
      set: {
        personaName: sql`excluded.persona_name`,
        profileUrl: sql`excluded.profile_url`,
        avatarUrl: sql`excluded.avatar_url`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
  }



  const changedUserIds = candidates
    .filter((candidate) => candidate.steam64 && changedSteam64s.has(candidate.steam64))
    .map((candidate) => candidate.id);
  for (const userId of changedUserIds) revalidatePublicPlayerTag(userId);
  return { processed: steam64s.length, updated: changedProfiles.length, unresolved };
}
