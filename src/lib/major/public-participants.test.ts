import { describe, expect, it } from "vitest";

import {
  presentMajorPublicParticipantPhase,
  resolveConfirmedMajorSeeds,
  resolveMajorPublicParticipantLifecycle,
} from "./public-participants";

const approvedEntryIds = ["entry-1", "entry-2", "entry-3", "entry-4"];

describe("Major public participant presentation", () => {
  it("keeps approved candidates out of formal entrant language", () => {
    const lifecycle = resolveMajorPublicParticipantLifecycle({
      entrantCapacity: 4,
      approvedEntryIds: [...approvedEntryIds, "entry-5"],
      officialEntryIds: ["entry-1", "entry-2"],
      eventRosterFacts: [],
      entrantsLockedAt: null,
    });

    expect(lifecycle.phase).toBe("approved_candidates");
    expect(lifecycle.officialSetComplete).toBe(false);
    expect(presentMajorPublicParticipantPhase(lifecycle.phase)).toMatchObject({
      teamCollectionLabel: "已通过报名审核的队伍",
      playerDescription: "以下选手来自已通过审核的队伍，正赛名单待确认。",
    });
  });

  it("only treats a complete selected set as final and requires every selected roster to be frozen", () => {
    const final = resolveMajorPublicParticipantLifecycle({
      entrantCapacity: 4,
      approvedEntryIds,
      officialEntryIds: approvedEntryIds,
      eventRosterFacts: approvedEntryIds.map((entryId) => ({ entryId, status: "confirmed" as const })),
      entrantsLockedAt: null,
    });
    expect(final.phase).toBe("final_entrants");

    const frozen = resolveMajorPublicParticipantLifecycle({
      entrantCapacity: 4,
      approvedEntryIds,
      officialEntryIds: approvedEntryIds,
      eventRosterFacts: approvedEntryIds.map((entryId) => ({ entryId, status: "frozen" as const })),
      entrantsLockedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(frozen.phase).toBe("rosters_frozen");
    expect(presentMajorPublicParticipantPhase(frozen.phase).teamCollectionDescription).toContain("最终参赛名单");

    const inconsistent = resolveMajorPublicParticipantLifecycle({
      entrantCapacity: 4,
      approvedEntryIds,
      officialEntryIds: approvedEntryIds,
      eventRosterFacts: approvedEntryIds.map((entryId, index) => ({ entryId, status: index === 0 ? "confirmed" as const : "frozen" as const })),
      entrantsLockedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(inconsistent.phase).toBe("final_entrants");
  });

  it("suppresses seeds until confirmation and complete unique coverage", () => {
    const incomplete = resolveConfirmedMajorSeeds({
      entrantCapacity: 4,
      officialEntryIds: approvedEntryIds,
      seedsConfirmedAt: new Date("2026-09-01T00:00:00Z"),
      seedRows: approvedEntryIds.slice(0, 3).map((entryId, index) => ({ entryId, seed: index + 1 })),
    });
    expect(incomplete).toBeNull();

    const complete = resolveConfirmedMajorSeeds({
      entrantCapacity: 4,
      officialEntryIds: approvedEntryIds,
      seedsConfirmedAt: new Date("2026-09-01T00:00:00Z"),
      seedRows: approvedEntryIds.map((entryId, index) => ({ entryId, seed: 4 - index })),
    });
    expect(complete && [...complete.entries()]).toEqual([
      ["entry-1", 4],
      ["entry-2", 3],
      ["entry-3", 2],
      ["entry-4", 1],
    ]);

    expect(resolveConfirmedMajorSeeds({
      entrantCapacity: 4,
      officialEntryIds: approvedEntryIds,
      seedsConfirmedAt: null,
      seedRows: approvedEntryIds.map((entryId, index) => ({ entryId, seed: index + 1 })),
    })).toBeNull();
  });
});
