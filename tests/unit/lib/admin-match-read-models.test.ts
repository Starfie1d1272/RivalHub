import { describe, expect, it } from "vitest";
import {
  buildBatchDeadlineGroups,
  mapCompletedMaps,
  mapFinishedMaps,
  mapPendingMaps,
  projectAdminMatchSummary,
  sortAdminMatches,
} from "@/lib/admin/matches/shared";
import type { AdminMatchMapRecord } from "@/lib/admin/matches/types";
import type { Match } from "@/db/schema";
import type { StagePlan } from "@/types/season";

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "match-1",
    seasonId: "season-1",
    entryAId: "entry-a",
    entryBId: "entry-b",
    stage: "swiss",
    round: 1,
    format: "bo1",
    entryRound: null,
    scoreA: null,
    scoreB: null,
    status: "scheduled",
    isForfeit: false,
    bracketNodeId: null,
    ownership: "major_stage",
    majorStageRunId: "run-1",
    managedKey: "swiss:1:1",
    scheduledAt: null,
    completionDeadline: null,
    completedAt: null,
    videoUrl: "https://video.example/detail-only",
    mvpWinnerUserId: null,
    createdAt: new Date("2026-09-05T00:00:00.000Z"),
    updatedAt: new Date("2026-09-05T00:00:00.000Z"),
    ...overrides,
  };
}

const stagePlan: StagePlan = [{
  key: "swiss",
  name: "Swiss",
  type: "swiss",
  teamCount: 4,
  advanceTiers: [],
}];

describe("admin match read-model projections", () => {
  it("keeps detail-only match fields out of the overview summary", () => {
    const summary = projectAdminMatchSummary(match());

    expect(summary).toMatchObject({ id: "match-1", stage: "swiss", status: "scheduled" });
    expect(summary).not.toHaveProperty("videoUrl");
    expect(summary).not.toHaveProperty("mvpWinnerUserId");
    expect(summary).not.toHaveProperty("managedKey");
  });

  it("groups only active matches for batch deadlines", () => {
    const groups = buildBatchDeadlineGroups([
      match({ id: "scheduled-1", round: 1, status: "scheduled" }),
      match({ id: "live-1", round: 1, status: "in_progress" }),
      match({ id: "finished-1", round: 1, status: "finished" }),
      match({ id: "cancelled-1", round: 1, status: "cancelled" }),
    ], stagePlan);

    expect(groups).toEqual([{ label: "Swiss · 第 1 轮", stage: "swiss", round: 1, entryRound: null, matchCount: 2 }]);
  });

  it("sorts live and scheduled matches before finished matches", () => {
    const sorted = sortAdminMatches([
      match({ id: "finished", status: "finished", completedAt: new Date("2026-09-05T04:00:00Z") }),
      match({ id: "scheduled", status: "scheduled", scheduledAt: new Date("2026-09-05T02:00:00Z") }),
      match({ id: "live", status: "in_progress", scheduledAt: new Date("2026-09-05T03:00:00Z") }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["live", "scheduled", "finished"]);
  });

  it("splits map records into the three workbench projections", () => {
    const records: AdminMatchMapRecord[] = [
      { id: "map-1", matchId: "match-1", mapOrder: 1, mapName: "de_inferno", scoreA: 13, scoreB: 9, pickedByEntryId: "entry-a", teamAStartSide: "t" },
      { id: "map-2", matchId: "match-1", mapOrder: 2, mapName: "de_nuke", scoreA: null, scoreB: null, pickedByEntryId: "entry-b", teamAStartSide: "ct" },
    ];

    expect(mapCompletedMaps(records)).toEqual([{ mapOrder: 1, mapName: "de_inferno", scoreA: 13, scoreB: 9, pickedByEntryId: "entry-a", teamAStartSide: "t" }]);
    expect(mapPendingMaps(records)).toEqual([{ mapOrder: 2, mapName: "de_nuke", pickedByEntryId: "entry-b", teamAStartSide: "ct" }]);
    expect(mapFinishedMaps(records)).toEqual([{ id: "map-1", mapName: "de_inferno", scoreA: 13, scoreB: 9 }]);
  });
});
