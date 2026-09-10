import { describe, expect, it } from "vitest";
import { createStageBracket, serializeStageBracket } from "@/lib/bracket";

function makeTeams(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${index}`,
    name: `Team ${index + 1}`,
    competitionId: "season-1",
    formationOrder: index + 1,
  })) as never;
}

describe("stage-scoped bracket adapter", () => {
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
});
