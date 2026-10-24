import { expect, it } from "vitest";
import { selectSeasonDirectoryPage } from "./directory-page";
import type { SeasonLifecycleInput } from "./presentation";

it("keeps future registration reachable with no active event and on every history page", () => {
  const upcoming = { id: "future", status: "registration" as const, registrationOpenedAt: null, registrationOpensAt: new Date("2099-01-01"), hasOfficialMatches: false };
  const history: (SeasonLifecycleInput & { id: string })[] = Array.from({ length: 13 }, (_, i) => ({ id: `old-${i}`, status: i < 7 ? "finished" : "archived", lastCompletedAt: new Date(1700000000000 + i * 1000) }));
  const first = selectSeasonDirectoryPage([upcoming, ...history], "1");
  const second = selectSeasonDirectoryPage([upcoming, ...history], "2");
  expect(first.grouped.active).toEqual([]);
  expect(first.grouped.upcoming).toEqual([upcoming]);
  expect(second.grouped.upcoming).toEqual([upcoming]);
  const firstHistory = [...first.grouped.recent, ...first.grouped.archived];
  const secondHistory = [...second.grouped.recent, ...second.grouped.archived];
  expect(firstHistory).toHaveLength(12); expect(secondHistory).toHaveLength(1);
  expect(new Set([...firstHistory, ...secondHistory].map(season => season.id)).size).toBe(13);
  expect(first.pages).toBe(2);
  expect(selectSeasonDirectoryPage([upcoming], "999")).toMatchObject({ page: 1, pages: 1, grouped: { upcoming: [upcoming] } });
});
