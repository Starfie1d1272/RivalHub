import { groupSeasonsByLifecycle, type SeasonLifecycleInput } from "./presentation";

/** Only completed history is paged. Upcoming/active entries remain reachable on every page. */
export function selectSeasonDirectoryPage<T extends SeasonLifecycleInput>(seasons: readonly T[], pageValue?: string | number) {
  const grouped = groupSeasonsByLifecycle(seasons);
  const history = [...grouped.recent, ...grouped.archived];
  const pages = Math.max(1, Math.ceil(history.length / 12));
  const requested = Number(pageValue);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1;
  const visible = new Set(history.slice((page - 1) * 12, page * 12));
  return { page, pages, grouped: {
    ...grouped,
    recent: grouped.recent.filter(season => visible.has(season)),
    archived: grouped.archived.filter(season => visible.has(season)),
  } };
}
