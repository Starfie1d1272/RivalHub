import "server-only";

import { z } from "zod";
import { providerFetch } from "@/lib/observability/fetch";
import { captureException, logEvent, traceOperation } from "@/lib/observability/server";

const httpsUrl = z.string().url().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Steam 官方链接必须使用 HTTPS");
const optionalHttpsUrl = httpsUrl.nullish();

const summaryResponse = z.object({
  response: z.object({
    players: z.array(z.object({
      steamid: z.string(),
      personaname: z.string().min(1),
      profileurl: httpsUrl,
      avatarfull: optionalHttpsUrl,
    })),
  }),
});

export interface SteamProfileSummary {
  steam64: string;
  personaName: string;
  profileUrl: string;
  avatarUrl: string | null;
}

export type SteamProfileLookup =
  | { status: "ok"; profiles: Map<string, SteamProfileSummary> }
  | { status: "unconfigured" | "failed" };

/** Safe projection only; GetPlayerSummaries accepts at most 100 SteamIDs. */
export async function getSteamPlayerSummaries(steam64s: readonly string[]): Promise<SteamProfileLookup> {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    logEvent({
      level: "warn",
      event: "provider.steam.unconfigured",
      scope: "provider",
      operation: "steam.profile_lookup",
      errorClass: "dependency",
      retryable: false,
      safeContext: { provider: "steam" },
    });
    return { status: "unconfigured" };
  }
  const ids = [...new Set(steam64s.filter((id) => /^\d{17}$/.test(id)))];
  return traceOperation("provider.steam.profile", {
    scope: "provider",
    operation: "steam.profile_lookup",
    provider: "steam",
  }, async () => {
    const profiles = new Map<string, SteamProfileSummary>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      try {
        const response = await providerFetch("steam")(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${batch.join(",")}`,
          {
            signal: AbortSignal.timeout(3000),
            cache: "no-store",
          },
        );
        if (!response.ok) {
          logEvent({
            level: "warn",
            event: "provider.steam.http_failure",
            scope: "provider",
            operation: "steam.profile_lookup",
            errorClass: "dependency",
            retryable: response.status >= 500 || response.status === 429,
            safeContext: { provider: "steam", httpStatus: response.status },
          });
          return { status: "failed" };
        }
        const parsed = summaryResponse.safeParse(await response.json());
        if (!parsed.success) throw new Error("Invalid Steam summary response");
        for (const player of parsed.data.response.players) {
          if (!batch.includes(player.steamid)) continue;
          profiles.set(player.steamid, {
            steam64: player.steamid,
            personaName: player.personaname,
            profileUrl: player.profileurl,
            avatarUrl: player.avatarfull ?? null,
          });
        }
      } catch {
        // Provider exceptions may contain the credential-bearing request URL.
        captureException(
          "provider.steam.failure",
          new Error("Steam profile lookup failed"),
          {
            scope: "provider",
            operation: "steam.profile_lookup",
            provider: "steam",
            errorClass: "dependency",
            retryable: true,
          },
        );
        return { status: "failed" };
      }
    }
    return { status: "ok", profiles };
  });
}
