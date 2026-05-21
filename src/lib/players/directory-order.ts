interface DirectoryPlayer {
  name: string;
  currentRating: number;
  stats: {
    maps: number;
    avgRating: number;
  } | null;
}

export function sortPlayerDirectory<T extends DirectoryPlayer>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const mapsDiff = (b.stats?.maps ?? -1) - (a.stats?.maps ?? -1);
    if (mapsDiff !== 0) return mapsDiff;

    const seasonRatingDiff = (b.stats?.avgRating ?? -1) - (a.stats?.avgRating ?? -1);
    if (seasonRatingDiff !== 0) return seasonRatingDiff;

    const registrationRatingDiff = b.currentRating - a.currentRating;
    if (registrationRatingDiff !== 0) return registrationRatingDiff;

    return a.name.localeCompare(b.name);
  });
}
