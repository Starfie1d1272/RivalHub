import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ career: vi.fn(), benchmark: vi.fn(), records: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {
  select: () => {
    const query: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "where", "orderBy", "groupBy"]) query[method] = () => query;
    query.execute = () => Promise.resolve([]);
    query.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return query;
  },
} }));
vi.mock("@/lib/data/public-players", () => ({ getPublicPlayerById: vi.fn() }));
vi.mock("@/lib/data/public-seasons", () => ({ getPublicSeasonBySlug: vi.fn() }));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResults: vi.fn() }));
vi.mock("@/lib/stats/cached-query", () => ({ getPublicPlayerCareerDetail: mocks.career }));
vi.mock("@/lib/stats/player-attribute-benchmark", () => ({ getPlayerAttributeBenchmark: mocks.benchmark }));
vi.mock("@/lib/stats/player-attributes", () => ({ projectPlayerAttributeProfile: () => ({ attributes: [] }) }));
vi.mock("@/lib/players/public-record", () => ({ getPublicPlayerRecords: mocks.records }));
vi.mock("@/lib/competitive/public-catalog", () => ({ getPublicCompetitiveCatalog: async () => [] }));
vi.mock("@/lib/recruitment/data", () => ({ getPublicPlayerLft: async () => null }));
vi.mock("@/lib/discipline/public-query", () => ({ getPublicPlayerSanctions: async () => [] }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));

import { createPublicPlayerProfileSections } from "@/lib/players/public-profile";

const known = { user: { id: "player" }, sanctions: [] } as unknown as Parameters<typeof createPublicPlayerProfileSections>[0];
const detail = (rating: number, performance: object | null = {}) => ({ scoreboard: [{ avgRating: rating }], summary: { maps: 2 }, performance });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.records.mockResolvedValue(new Map());
});

it("streams basic facts before slow career/history, shares unfiltered performance and lazily shares attributes", async () => {
  const career = deferred<ReturnType<typeof detail>>();
  const history = deferred<Map<string, never>>();
  const benchmark = deferred<object>();
  mocks.career.mockReturnValue(career.promise);
  mocks.records.mockReturnValue(history.promise);
  mocks.benchmark.mockReturnValue(benchmark.promise);
  const sections = createPublicPlayerProfileSections(known);
  expect(await sections.basic).toMatchObject({ user: known.user, currentTeams: [], publicEducationIdentities: [] });
  expect(mocks.career).toHaveBeenCalledExactlyOnceWith({ playerId: "player" });
  expect(mocks.benchmark).not.toHaveBeenCalled();
  career.resolve(detail(1.2));
  expect((await sections.overview).careerOverview.rating).toBe(1.2);
  expect((await sections.performance).career?.performance).toEqual({});
  expect(mocks.benchmark).not.toHaveBeenCalled();
  const first = sections.attributes();
  expect(sections.attributes()).toBe(first);
  benchmark.resolve({});
  expect(await first).toMatchObject({ benchmarkUnavailable: false });
  expect(mocks.benchmark).toHaveBeenCalledTimes(1);
  history.resolve(new Map<string, never>());
  expect(await sections.history).toEqual({ careerHistory: [], registrationSnapshots: [] });
});

it("keeps scoped performance separate from lifetime and skips benchmark for no performance", async () => {
  mocks.career.mockImplementation((scope: { eventSlug?: string }) => Promise.resolve(detail(scope.eventSlug ? 2 : 1, null)));
  const sections = createPublicPlayerProfileSections(known, { eventSlug: "event", mapFilter: "de_mirage" });
  expect((await sections.overview).careerOverview.rating).toBe(1);
  expect((await sections.performance).career?.scoreboard[0]?.avgRating).toBe(2);
  expect(mocks.career).toHaveBeenNthCalledWith(2, { playerId: "player", eventSlug: "event", mapFilter: "de_mirage" });
  expect(await sections.attributes()).toEqual({ attributes: null, benchmarkUnavailable: false });
  expect(mocks.benchmark).not.toHaveBeenCalled();
  await sections.history;
});

it("preserves identity when statistics fail and reports benchmark failure separately", async () => {
  const offline = Object.assign(new Error("offline"), { code: "ECONNRESET" });
  mocks.career.mockRejectedValue(offline);
  const unavailable = createPublicPlayerProfileSections(known);
  expect((await unavailable.basic).user).toBe(known.user);
  expect(await unavailable.performance).toEqual({ career: null, statsUnavailable: true });
  expect((await unavailable.overview).careerOverview.maps).toBeNull();
  expect(await unavailable.attributes()).toEqual({ attributes: null, benchmarkUnavailable: false });
  await unavailable.history;

  mocks.career.mockResolvedValue(detail(1));
  mocks.benchmark.mockRejectedValue(offline);
  const sections = createPublicPlayerProfileSections(known);
  expect((await sections.performance).statsUnavailable).toBe(false);
  expect(await sections.attributes()).toEqual({ attributes: null, benchmarkUnavailable: true });
  await Promise.all([sections.basic, sections.history, sections.overview]);
});
