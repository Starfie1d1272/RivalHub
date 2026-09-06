export const TEAM_DIRECTORY_DEFAULTS = {
  q: "",
  status: "active",
  recruiting: false,
  sort: "default",
} as const;

export type TeamDirectoryStatus = "active" | "history";
export type TeamDirectorySort = "default" | "name" | "members_asc" | "members_desc";

export interface TeamDirectoryQuery {
  q?: string;
  status: TeamDirectoryStatus;
  recruiting: boolean;
  sort: TeamDirectorySort;
}

export type TeamDirectorySearchParams = URLSearchParams | Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(input: TeamDirectorySearchParams, key: string): string | undefined {
  return input instanceof URLSearchParams ? input.get(key) ?? undefined : firstValue(input[key]);
}

export function normalizeTeamDirectoryQuery(input: TeamDirectorySearchParams): TeamDirectoryQuery {
  const q = readParam(input, "q")?.trim() || undefined;
  const rawStatus = readParam(input, "status");
  const rawSort = readParam(input, "sort");
  const rawRecruiting = readParam(input, "recruiting");

  return {
    q,
    status: rawStatus === "history" ? "history" : TEAM_DIRECTORY_DEFAULTS.status,
    recruiting: rawRecruiting === "true" || rawRecruiting === "1",
    sort: rawSort === "name" || rawSort === "members_asc" || rawSort === "members_desc"
      ? rawSort
      : TEAM_DIRECTORY_DEFAULTS.sort,
  };
}
