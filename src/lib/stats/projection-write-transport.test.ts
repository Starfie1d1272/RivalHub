import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ encode: vi.fn(), insert: vi.fn(), collect: vi.fn() }));
vi.mock("./projection-transport", () => ({ encodePerformanceTransport: mocks.encode }));
vi.mock("@cs2dak/tournament", () => ({ collectTournamentPerformanceMapProjection: mocks.collect, buildTournamentPerformanceAnalyticsFromProjections: vi.fn(() => ({})) }));
vi.mock("./evidence-adapter", () => ({ adaptStatsEvidence: () => ({ performance: {}, tournament: {} }) }));
vi.mock("./record-facts", () => ({ collectRecordFacts: () => ({ candidates: [], equipmentSampling: "unknown", economyKnownRounds: 0 }) }));
import { materializeStatisticsProjectionInTx } from "./projection";

it("writes both complete legacy versions if transport is unavailable", async () => {
  mocks.encode.mockResolvedValue(null);
  const performance = { mapKey: "map", data: { complete: true } };
  mocks.collect.mockReturnValue(performance);
  const rows: Array<{ facts: { performance: unknown; performanceTransport?: unknown } }> = [];
  const tx = { insert: () => ({ values: (row: typeof rows[number]) => ({ onConflictDoUpdate: async () => { rows.push(row); } }) }) };
  const input = { tx, row: { id: "import" }, evidence: { participants: [{ steamId64: "steam" }] },
    target: { roster: [{ userId: "user", entryId: "entry" }] }, resolutions: new Map([["steam", { userId: "user" }]]) };
  await materializeStatisticsProjectionInTx(input as never);
  expect(mocks.collect).toHaveBeenCalledTimes(1);
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.facts.performance === performance && !("performanceTransport" in row.facts))).toBe(true);
});
