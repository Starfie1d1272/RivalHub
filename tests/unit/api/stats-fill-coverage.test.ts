import { expect, it, vi } from "vitest";
const reads = vi.hoisted(() => ({ tournament: vi.fn(), careers: vi.fn(), benchmark: vi.fn(), selection: vi.fn() }));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
  transaction: async (read: (tx: object) => unknown) => read({}),
} }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/stats/tournament-query", () => ({ getTournamentStats: reads.tournament, getPlayerCareerPerformances: reads.careers,
  getCurrentStatsSelectionInTx: reads.selection, getTournamentRecordEvents: vi.fn() }));
vi.mock("@/lib/stats/player-attribute-benchmark", () => ({ getPlayerAttributeBenchmark: reads.benchmark }));
vi.mock("@/lib/stats/public-view", () => ({ publicStatsView: (data: unknown) => data }));
import { getPlatformStatsPage } from "@/lib/stats/platform-query";
import { getPublicLineupStyle } from "@/lib/teams/lineup-style-query";
import { getLineupCareers } from "@/lib/matches/lineup-comparison-query";
import { getRuntimeResourceSnapshot } from "@/lib/observability/runtime-resources";

const resource = () => getRuntimeResourceSnapshot().find(row => row.name === "stats.public.fill")!;
it.each([
  ["platform", () => getPlatformStatsPage({}), reads.tournament],
  ["lineup style", () => getPublicLineupStyle([{ userId: "fixture", name: "Fixture", avatarUrl: null, hasActivePublicSanction: false }]), reads.careers],
  ["lineup comparison", () => getLineupCareers(["fixture"], "fixture-match", null), reads.selection],
] as const)("counts the real %s body and releases it after a failed dependency", async (_label, read, dependency) => {
  const before = resource();
  let fail!: (error: Error) => void;
  dependency.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  reads.benchmark.mockResolvedValue({});
  const pending = read();
  await vi.waitFor(() => expect(resource().inFlight).toBe(before.inFlight + 1));
  const failure = new Error("fixture dependency failed");
  fail(failure);
  await expect(pending).rejects.toBe(failure);
  expect(resource()).toMatchObject({ inFlight: before.inFlight, count: before.count + 1 });
});
