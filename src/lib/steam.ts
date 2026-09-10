import "server-only";

import { z } from "zod";
import { providerFetch } from "@/lib/observability/fetch";
import { captureException, logEvent, traceOperation } from "@/lib/observability/server";

const summaryResponse = z.object({ response: z.object({ players: z.array(z.object({
  steamid: z.string(),
  avatarfull: z.string().url(),
})) }) });

export type SteamAvatarLookup =
  | { status: "ok"; avatars: Map<string, string> }
  | { status: "unconfigured" | "failed" };

/** Safe projection only; GetPlayerSummaries accepts at most 100 SteamIDs. */
export async function getSteamPlayerSummaries(steam64s: readonly string[]): Promise<SteamAvatarLookup> {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    logEvent({ level: "warn", event: "provider.steam.unconfigured", scope: "provider", operation: "steam.avatar_lookup", errorClass: "dependency", retryable: false, safeContext: { provider: "steam" } });
    return { status: "unconfigured" };
  }
  const ids = [...new Set(steam64s.filter((id) => /^\d{17}$/.test(id)))];
  return traceOperation("provider.steam.avatar", { scope: "provider", operation: "steam.avatar_lookup", provider: "steam" }, async () => {
    const avatars = new Map<string, string>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      try {
        const response = await providerFetch("steam")(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${batch.join(",")}`, {
          signal: AbortSignal.timeout(3000),
          cache: "no-store",
        });
        if (!response.ok) {
          logEvent({ level: "warn", event: "provider.steam.http_failure", scope: "provider", operation: "steam.avatar_lookup", errorClass: "dependency", retryable: response.status >= 500 || response.status === 429, safeContext: { provider: "steam", httpStatus: response.status } });
          return { status: "failed" };
        }
        const parsed = summaryResponse.safeParse(await response.json());
        if (!parsed.success) throw new Error("Invalid Steam summary response");
        for (const player of parsed.data.response.players) {
          if (batch.includes(player.steamid) && player.avatarfull.startsWith("https://")) avatars.set(player.steamid, player.avatarfull);
        }
      } catch {
        // Provider exceptions may contain the credential-bearing request URL.
        captureException("provider.steam.failure", new Error("Steam avatar lookup failed"), { scope: "provider", operation: "steam.avatar_lookup", provider: "steam", errorClass: "dependency", retryable: true });
        return { status: "failed" };
      }
    }
    return { status: "ok", avatars };
  });
}

/** Profile saves are best-effort; a changed identity never inherits an old avatar. */
export async function resolveSteamAvatarForProfile(
  current: { steam64: string | null; avatarUrl: string | null },
  nextSteam64: string | null,
): Promise<string | null> {
  if (!nextSteam64) return null;
  if (current.steam64 === nextSteam64 && current.avatarUrl) return current.avatarUrl;
  const result = await getSteamPlayerSummaries([nextSteam64]);
  return result.status === "ok" ? result.avatars.get(nextSteam64) ?? null : null;
}
