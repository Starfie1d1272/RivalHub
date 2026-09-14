import { describe, expect, it, vi } from "vitest";
import { createStageBracket, ensureResolvedBracketMatch, projectStageBracketNodes, resolveFinalBracketNodeId, serializeStageBracket } from "@/lib/bracket";

function makeTeams(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index}`,
    name: `Team ${index + 1}`,
    competitionId: "season-1",
    formationOrder: index + 1,
  })) as never;
}

describe("stage-scoped bracket adapter", () => {
  it("identifies a final by topology regardless of stage display name", async () => {
    const { data } = await createStageBracket({ key: "playoff", name: "任意名称", type: "single_elim" }, makeTeams(4));
    const finalId = resolveFinalBracketNodeId(serializeStageBracket(data));
    const final = data.match.find((match) => match.id === finalId);
    expect(final).toBeDefined();
    expect(data.round.find((round) => round.id === final?.round_id)?.number).toBe(2);
    expect(resolveFinalBracketNodeId({ ...serializeStageBracket(data), stage: [] })).toBeNull();
  });

  it("creates one provider stage and preserves stable RivalHub participant identity", async () => {
    const { data, resolvedMatches } = await createStageBracket(
      { key: "playoff", name: "展示名", type: "single_elim" },
      makeTeams(4),
    );

    expect(data.stage).toHaveLength(1);
    expect((data.stage as Array<{ name: string }>)[0]?.name).toBe("展示名");
    expect((data.participant as unknown as Array<{ rivalhubEntryId: string }>).map((p) => p.rivalhubEntryId))
      .toEqual(["entry-0", "entry-1", "entry-2", "entry-3"]);
    expect(resolvedMatches[0]).toEqual(expect.objectContaining({
      entryAId: expect.any(String),
      entryBId: expect.any(String),
    }));
  });

  it("projects provider state for the viewer without changing its stage identity", async () => {
    const { data } = await createStageBracket(
      { key: "playoff", name: "Playoff", type: "single_elim" },
      makeTeams(4),
    );
    const serialized = serializeStageBracket(data);
    expect(serialized.stage).toHaveLength(1);
    expect(serialized.match.length).toBeGreaterThan(0);
    expect(serialized.match[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      stage_id: serialized.stage[0]!.id,
      round_id: expect.any(Number),
      group_id: expect.any(Number),
      number: expect.any(Number),
      status: expect.any(Number),
    }));
  });

  it("projects single-elimination edges from provider topology", async () => {
    const { data } = await createStageBracket(
      { key: "playoff", name: "Playoff", type: "single_elim" },
      makeTeams(8),
    );

    expect(projectStageBracketNodes(serializeStageBracket(data)).map((node) => ({
      id: node.id,
      round: node.round,
      lane: node.lane,
      nextWinNodeId: node.nextWinNodeId,
      nextLossNodeId: node.nextLossNodeId,
    }))).toEqual([
      { id: "0", round: 1, lane: "single", nextWinNodeId: "4", nextLossNodeId: null },
      { id: "1", round: 1, lane: "single", nextWinNodeId: "4", nextLossNodeId: null },
      { id: "2", round: 1, lane: "single", nextWinNodeId: "5", nextLossNodeId: null },
      { id: "3", round: 1, lane: "single", nextWinNodeId: "5", nextLossNodeId: null },
      { id: "4", round: 2, lane: "single", nextWinNodeId: "6", nextLossNodeId: null },
      { id: "5", round: 2, lane: "single", nextWinNodeId: "6", nextLossNodeId: null },
      { id: "6", round: 3, lane: "single", nextWinNodeId: null, nextLossNodeId: null },
    ]);
  });

  it("projects double-elimination winner, loser and grand-final edges", async () => {
    const { data } = await createStageBracket(
      { key: "playoff", name: "Playoff", type: "double_elim" },
      makeTeams(8),
    );

    expect(projectStageBracketNodes(serializeStageBracket(data)).map((node) => ({
      id: node.id,
      round: node.round,
      lane: node.lane,
      nextWinNodeId: node.nextWinNodeId,
      nextLossNodeId: node.nextLossNodeId,
    }))).toEqual([
      { id: "0", round: 1, lane: "winner", nextWinNodeId: "4", nextLossNodeId: "7" },
      { id: "1", round: 1, lane: "winner", nextWinNodeId: "4", nextLossNodeId: "7" },
      { id: "2", round: 1, lane: "winner", nextWinNodeId: "5", nextLossNodeId: "8" },
      { id: "3", round: 1, lane: "winner", nextWinNodeId: "5", nextLossNodeId: "8" },
      { id: "4", round: 2, lane: "winner", nextWinNodeId: "6", nextLossNodeId: "10" },
      { id: "5", round: 2, lane: "winner", nextWinNodeId: "6", nextLossNodeId: "9" },
      { id: "6", round: 3, lane: "winner", nextWinNodeId: "13", nextLossNodeId: "12" },
      { id: "7", round: 2, lane: "loser", nextWinNodeId: "9", nextLossNodeId: null },
      { id: "8", round: 2, lane: "loser", nextWinNodeId: "10", nextLossNodeId: null },
      { id: "9", round: 3, lane: "loser", nextWinNodeId: "11", nextLossNodeId: null },
      { id: "10", round: 3, lane: "loser", nextWinNodeId: "11", nextLossNodeId: null },
      { id: "11", round: 4, lane: "loser", nextWinNodeId: "12", nextLossNodeId: null },
      { id: "12", round: 5, lane: "loser", nextWinNodeId: "13", nextLossNodeId: null },
      { id: "13", round: 6, lane: "grand", nextWinNodeId: null, nextLossNodeId: null },
    ]);
  });

  it("treats an exact resolved node as idempotent and rejects divergent reuse", async () => {
    const resolved = {
      bracketMatchId: 7,
      stageId: 1,
      entryAId: "entry-a",
      entryBId: "entry-b",
      roundNumber: 1,
      groupNumber: 1,
    };
    const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
    const mockFindFirst = vi.fn().mockResolvedValue({
      seasonId: "season-1",
      entryAId: "entry-a",
      entryBId: "entry-b",
      stage: "playoff",
      format: "bo3",
      bracketNodeId: "7",
      entryRound: null,
    });
    const database = {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      query: {
        matches: {
          findFirst: mockFindFirst,
        },
      },
    } as never;

    await expect(ensureResolvedBracketMatch(database, {
      seasonId: "season-1",
      stageKey: "playoff",
      resolved,
      format: "bo3",
    })).resolves.toBeUndefined();

    mockFindFirst.mockResolvedValueOnce({
      seasonId: "season-1",
      entryAId: "entry-other",
      entryBId: "entry-b",
      stage: "playoff",
      format: "bo3",
      bracketNodeId: "7",
      entryRound: null,
    });
    await expect(ensureResolvedBracketMatch(database, {
      seasonId: "season-1",
      stageKey: "playoff",
      resolved,
      format: "bo3",
    })).rejects.toThrow("拒绝静默复用");
  });
});
