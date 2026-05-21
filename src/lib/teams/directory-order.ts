type DirectoryTeam = {
  id: string;
  draftOrder: number;
};

type TeamDirectoryOrderOptions = {
  mode: "qualifier" | "playoff";
  standingsOrder?: string[];
  playoffSeedOrder?: string[];
};

type SwissDirectoryStanding = {
  teamId: string;
  seed: number;
  wins: number;
  losses: number;
  buScore: number;
  status: string;
};

function buildOrderMap(ids: string[] | undefined) {
  return new Map((ids ?? []).map((id, index) => [id, index]));
}

function sortedByOrder<T extends DirectoryTeam>(teams: T[], ids: string[] | undefined) {
  const order = buildOrderMap(ids);
  return [...teams].sort((a, b) => {
    const aOrder = order.get(a.id);
    const bOrder = order.get(b.id);

    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;
    return a.draftOrder - b.draftOrder;
  });
}

export function sortTeamDirectory<T extends DirectoryTeam>(
  teams: T[],
  options: TeamDirectoryOrderOptions,
) {
  if (options.mode === "playoff" && options.playoffSeedOrder?.length) {
    return sortedByOrder(teams, options.playoffSeedOrder);
  }

  if (options.standingsOrder?.length) {
    return sortedByOrder(teams, options.standingsOrder);
  }

  return sortedByOrder(teams, []);
}

export function getSwissDirectoryOrder(standings: SwissDirectoryStanding[]) {
  return [...standings]
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.losses !== b.losses) return a.losses - b.losses;
      if (b.buScore !== a.buScore) return b.buScore - a.buScore;
      return a.seed - b.seed;
    })
    .map((standing) => standing.teamId);
}
