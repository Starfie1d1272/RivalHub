interface DirectoryPlayer {
  name: string;
  currentRating: number;
  stats: {
    maps: number;
    rivalhubRR: number | null;
    hltvRating: number | null;
  } | null;
}

export function sortPlayerDirectory<T extends DirectoryPlayer>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const mapsDiff = (b.stats?.maps ?? -1) - (a.stats?.maps ?? -1);
    if (mapsDiff !== 0) return mapsDiff;

    const rrDiff = (b.stats?.rivalhubRR ?? -1) - (a.stats?.rivalhubRR ?? -1);
    if (rrDiff !== 0) return rrDiff;

    const seasonRatingDiff = (b.stats?.hltvRating ?? -1) - (a.stats?.hltvRating ?? -1);
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
