export type LeaderboardView = "core" | "impact" | "advanced";

const VIEW_SORTS = {
  core: ["maps", "rating", "adr", "kd", "kpr", "hs"],
  impact: ["maps", "rating", "fk", "mk", "clutch"],
  advanced: ["maps", "rating", "we", "rws"],
} as const satisfies Record<LeaderboardView, readonly string[]>;

const DEFAULT_SORT: Record<LeaderboardView, string> = {
  core: "rating",
  impact: "fk",
  advanced: "we",
};

function isLeaderboardView(value: string | undefined): value is LeaderboardView {
  return value === "core" || value === "impact" || value === "advanced";
}

function viewForSort(sort: string | undefined): LeaderboardView | null {
  if (!sort) return null;
  for (const [view, sorts] of Object.entries(VIEW_SORTS) as [LeaderboardView, readonly string[]][]) {
    if (sorts.includes(sort)) return view;
  }
  return null;
}

export function normalizeLeaderboardState({
  sort,
  view,
}: {
  sort?: string;
  view?: string;
}) {
  const explicitView = isLeaderboardView(view) ? view : null;
  const normalizedView = explicitView ?? viewForSort(sort) ?? "core";
  const availableSorts: readonly string[] = VIEW_SORTS[normalizedView];
  const normalizedSort = availableSorts.includes(sort ?? "")
    ? sort!
    : DEFAULT_SORT[normalizedView];

  return {
    sort: normalizedSort,
    view: normalizedView,
  };
}
