import { describe, expect, it } from "vitest";
import { calculateStageRoundRobinStandings } from "@/lib/matches/stage-standings";
import type { Match } from "@/db/schema/matches";
import type { CompetitionEntry } from "@/db/schema/competition-entries";

function entry(id: string, formationOrder: number): CompetitionEntry {
  return {
    id,
    competitionId: "season-1",
    source: "event_native",
    teamId: null,
    sourceRegistrationId: null,
    formationOrder,
    name: id,
    logoUrl: null,
    representativeUserId: "user-1",
    registrationStatus: "approved",
    perfectTeamId: null,
    currentRosterRevisionId: "revision-1",
    approvedRosterRevisionId: "revision-1",
    submittedAt: null,
    reviewedAt: null,
    reviewReason: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function match(id: string, entryAId: string, entryBId: string, scoreA: number, scoreB: number): Match {
  return {
    id,
    seasonId: "season-1",
    entryAId,
    entryBId,
    stage: "round-robin",
    round: null,
    format: "bo1",
    entryRound: null,
    scoreA,
    scoreB,
    status: "finished",
    isForfeit: false,
    bracketNodeId: null,
    ownership: "manual",
    majorStageRunId: null,
    qualificationRunId: null,
    managedKey: null,
    scheduledAt: null,
    completionDeadline: null,
    completedAt: new Date("2026-01-01T00:00:00.000Z"),
    videoUrl: null,
    mvpWinnerUserId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("stage-scoped round-robin standings", () => {
  it("uses provider entrant ids and never leaks another season entry", () => {
    const entries = [entry("entry-a", 1), entry("entry-b", 2), entry("entry-c", 3), entry("entry-other", 4)];
    const stageMatches = [
      match("match-ab", "entry-a", "entry-b", 1, 0),
      match("match-ac", "entry-a", "entry-c", 0, 1),
      match("match-bc", "entry-b", "entry-c", 1, 0),
      match("match-other", "entry-a", "entry-other", 1, 0),
    ];
    const roundScores = new Map([
      ["match-ab", [{ scoreA: 13, scoreB: 7 }]],
      ["match-ac", [{ scoreA: 8, scoreB: 13 }]],
      ["match-bc", [{ scoreA: 13, scoreB: 10 }]],
      ["match-other", [{ scoreA: 13, scoreB: 0 }]],
    ]);

    const standings = calculateStageRoundRobinStandings({
      stage: { type: "round_robin", teamCount: 3 },
      stageMatches,
      entries,
      stageEntrantIds: ["entry-a", "entry-b", "entry-c"],
      roundScoresByMatchId: roundScores,
    });

    expect(standings).toHaveLength(3);
    expect(new Set(standings.map((standing) => standing.teamId))).toEqual(new Set(["entry-a", "entry-b", "entry-c"]));
    expect(standings.find((standing) => standing.teamId === "entry-a")).toMatchObject({ wins: 1, losses: 1, netRounds: 1 });
  });

  it("does not recover standings from an incomplete historical stage", () => {
    expect(calculateStageRoundRobinStandings({
      stage: { type: "round_robin", teamCount: 3 },
      stageMatches: [match("match-ab", "entry-a", "entry-b", 1, 0)],
      entries: [entry("entry-a", 1), entry("entry-b", 2), entry("entry-c", 3)],
      roundScoresByMatchId: new Map(),
    })).toEqual([]);
  });
});
