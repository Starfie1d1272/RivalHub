import { describe, expect, it } from "vitest";
import { buildEvidenceRevision, sha256Json } from "./revision";

const base = {
  seasonId: "00000000-0000-4000-8000-000000000001",
  stageKey: "swiss",
  stageRunId: null,
  matchId: "00000000-0000-4000-8000-000000000002",
  matchMapId: "00000000-0000-4000-8000-000000000003",
  mapOrder: 1,
  mapName: "de_ancient",
  mapScoreA: 13,
  mapScoreB: 9,
  mapCompletedAt: "2026-09-13T00:00:00.000Z",
  matchStatus: "finished",
  entryAId: "00000000-0000-4000-8000-000000000004",
  entryBId: "00000000-0000-4000-8000-000000000005",
  roster: [{ entryId: "00000000-0000-4000-8000-000000000004", eventRosterMemberId: "00000000-0000-4000-8000-000000000006", userId: "00000000-0000-4000-8000-000000000007", steam64: "76561198000000001", isStarter: true }],
};

describe("Demo evidence revision", () => {
  it("is stable across roster order and changes when target facts change", () => {
    const first = buildEvidenceRevision(base);
    const reordered = buildEvidenceRevision({ ...base, roster: [...base.roster].reverse() });
    expect(reordered).toBe(first);
    expect(buildEvidenceRevision({ ...base, mapScoreA: 12 })).not.toBe(first);
  });

  it("hashes object keys canonically", () => {
    expect(sha256Json({ a: 1, nested: { b: 2, a: 3 } })).toBe(sha256Json({ nested: { a: 3, b: 2 }, a: 1 }));
  });
});
