interface DirectoryPlayer {
  name: string;
  currentRating: number;
  stats: {
    maps: number;
    avgRating: number;
    avgRr?: number | null;
  } | null;
}

export function sortPlayerDirectory<T extends DirectoryPlayer>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const mapsDiff = (b.stats?.maps ?? -1) - (a.stats?.maps ?? -1);
    if (mapsDiff !== 0) return mapsDiff;

    // RR 为门面评分，优先排序；无 RR 时回退完美 Rating
    const rrDiff = (b.stats?.avgRr ?? -1) - (a.stats?.avgRr ?? -1);
    if (rrDiff !== 0) return rrDiff;

    const seasonRatingDiff = (b.stats?.avgRating ?? -1) - (a.stats?.avgRating ?? -1);
    if (seasonRatingDiff !== 0) return seasonRatingDiff;

    const registrationRatingDiff = b.currentRating - a.currentRating;
    if (registrationRatingDiff !== 0) return registrationRatingDiff;

    return a.name.localeCompare(b.name);
  });
}

export function countDirectoryPlayersWithTeam(
  players: { registrationId: string }[],
  teamByRegId: Map<string, unknown>,
) {
  return players.filter((player) => teamByRegId.has(player.registrationId)).length;
}
