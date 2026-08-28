import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const publicStatsPages = [
  "src/app/[seasonSlug]/stats/page.tsx",
  "src/app/[seasonSlug]/teams/[teamId]/page.tsx",
  "src/app/players/[userId]/page.tsx",
];

describe("public match stats schema contract", () => {
  it("does not query the unpersisted match_player_stats.source column", () => {
    for (const relativePath of publicStatsPages) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).not.toMatch(/(?:mps|match_player_stats(?:\"|`|'))\.source/);
    }
  });
});
