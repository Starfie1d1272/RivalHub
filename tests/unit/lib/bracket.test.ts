import { describe, expect, it } from "vitest";
import { generateBracket, serializeBracket } from "@/lib/bracket";

function makeTeams(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `team-${index}`,
    name: `Team ${index + 1}`,
    draftOrder: index + 1,
  })) as never;
}

describe("serializeBracket()", () => {
  it("preserves brackets-viewer match fields from brackets-manager data", async () => {
    const { data } = await generateBracket(makeTeams(4), {
      qualifierFormat: null,
      playoffFormat: "single_elim",
      playoffName: "Playoff",
    });

    const serialized = serializeBracket(data, makeTeams(4));

    expect(serialized.stage).toHaveLength(1);
    expect(serialized.match.length).toBeGreaterThan(0);
    expect(serialized.match[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        stage_id: serialized.stage[0].id,
        round_id: expect.any(Number),
        group_id: expect.any(Number),
        number: expect.any(Number),
        status: expect.any(Number),
      }),
    );
  });
});
