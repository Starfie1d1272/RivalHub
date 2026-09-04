import "server-only";

import { captureException, logEvent } from "@/lib/observability/logger";
import { providerFetch } from "@/lib/observability/fetch";
import { traceOperation } from "@/lib/observability/tracing";

interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  avatarfull: string;
  profileurl: string;
}

interface SteamApiResponse {
  response: { players: SteamPlayerSummary[] };
}

export async function getSteamAvatar(steam64: string): Promise<string | null> {
  const key = process.env.STEAM_API_KEY;
  if (!key || !steam64) return null;

  return traceOperation("provider.steam.avatar", {
    scope: "provider",
    operation: "steam.avatar_lookup",
    provider: "steam",
  }, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${steam64}`;
    try {
      const res = await providerFetch("steam")(url, {
        signal: controller.signal,
        next: { revalidate: 3600 },
      });
      if (!res.ok) {
        logEvent({
          level: "warn",
          event: "provider.steam.http_failure",
          scope: "provider",
          operation: "steam.avatar_lookup",
          errorClass: "dependency",
          retryable: res.status >= 500 || res.status === 429,
          safeContext: { provider: "steam", httpStatus: res.status },
        });
        return null;
      }
      const data: SteamApiResponse = await res.json();
      return data.response.players[0]?.avatarfull ?? null;
    } catch (error) {
      captureException("provider.steam.failure", error, {
        scope: "provider",
        operation: "steam.avatar_lookup",
        provider: "steam",
        errorClass: "dependency",
        retryable: true,
      });
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}
