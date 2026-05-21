type DirectoryTeam = {
  id: string;
  draftOrder: number;
};

type TeamDirectoryOrderOptions = {
  mode: "qualifier" | "playoff";
  standingsOrder?: string[];
  playoffSeedOrder?: string[];
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
