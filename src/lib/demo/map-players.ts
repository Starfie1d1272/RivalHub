export interface DemoPlayerInput { steamId64: string; name: string; teamKey: string; }
export interface MappedPlayer extends DemoPlayerInput { userId: string | null; }

export function mapDemoPlayers(
  players: DemoPlayerInput[],
  steamIdToUserId: Map<string, string>,
): { mapped: MappedPlayer[]; unmatched: string[] } {
  const mapped: MappedPlayer[] = [];
  const unmatched: string[] = [];
  for (const p of players) {
    const userId = steamIdToUserId.get(p.steamId64) ?? null;
    if (!userId) unmatched.push(p.name);
    mapped.push({ ...p, userId });
  }
  return { mapped, unmatched };
}
