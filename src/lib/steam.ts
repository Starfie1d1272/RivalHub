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
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${steam64}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data: SteamApiResponse = await res.json();
    return data.response.players[0]?.avatarfull ?? null;
  } catch {
    return null;
  }
}
