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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${steam64}`;
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data: SteamApiResponse = await res.json();
    return data.response.players[0]?.avatarfull ?? null;
  } catch {
    return null;
  }
}

/** 优先从 Steam API 拉取最新头像，DB 缓存 URL 做兜底 */
export async function resolveAvatarUrl(user: {
  avatarUrl?: string | null;
  steam64?: string | null;
}): Promise<string | null> {
  const freshUrl = user.steam64 ? await getSteamAvatar(user.steam64) : null;
  return freshUrl ?? user.avatarUrl ?? null;
}
