import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";

const target = {
  match: { id: "match", seasonId: "season", stage: "final", majorStageRunId: null, status: "in_progress" as const, entryAId: "a", entryBId: "b" },
  map: { id: "map", mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, completedAt: new Date("2026-09-28T00:00:00.000Z") },
  roster: [],
};

describe("completed map evidence revision", () => {
  it("survives terminal series status changes and still changes when the official map score changes", () => {
    const duringSeries = buildEvidenceRevisionForTarget(target);
    expect(buildEvidenceRevisionForTarget({ ...target, match: { ...target.match, status: "finished" } })).toBe(duringSeries);
    expect(buildEvidenceRevisionForTarget({ ...target, match: { ...target.match, status: "cancelled" } })).toBe(duringSeries);
    expect(buildEvidenceRevisionForTarget({ ...target, map: { ...target.map, scoreA: 16 } })).not.toBe(duringSeries);
  });
});
