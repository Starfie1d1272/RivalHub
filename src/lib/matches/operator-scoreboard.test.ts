import { describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import { loadOperatorScoreboard } from "./operator-scoreboard";

const EXPECTED_KEYS = ["adr", "assists", "clutches", "deaths", "firstKills", "gameplayLocked", "hsPercent", "kills", "multiKills", "perfectName", "ratingPro", "rws", "userId", "we"].sort();

function databaseReturning(rows: Record<string, unknown>[]) {
  const selected: Record<string, unknown>[] = [];
  const database = {
    select: (columns: Record<string, unknown>) => {
      selected.push(columns);
      return { from: () => ({ where: () => ({ orderBy: async () => rows }) }) };
    },
  };
  return { database: database as unknown as TxDb, selected };
}

describe("operator scoreboard read model", () => {
  it("projects editor cells plus a derived ownership flag and nothing else", async () => {
    const { database, selected } = databaseReturning([
      { perfectName: "Demo Player", userId: "u1", kills: 20, deaths: 10, assists: 5, hsPercent: 50, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, rws: 7, ratingPro: 1.2, we: 8, dakImportId: "import-1" },
      { perfectName: "OCR Player", userId: null, kills: 4, deaths: 9, assists: 1, hsPercent: null, firstKills: null, multiKills: null, clutches: null, adr: 30, rws: null, ratingPro: 0.8, we: null, dakImportId: null },
    ]);

    const rows = await loadOperatorScoreboard(database, "map-1");

    expect(Object.keys(rows[0]).sort()).toEqual(EXPECTED_KEYS);
    expect(rows[0]).toMatchObject({ perfectName: "Demo Player", kills: 20, gameplayLocked: true });
    expect(rows[0]).not.toHaveProperty("dakImportId");
    expect(rows[1]).toMatchObject({ perfectName: "OCR Player", gameplayLocked: false, we: null });
    const selectedColumns = Object.keys(selected[0]);
    expect(selectedColumns).not.toContain("verifiedByAdmin");
    expect(selectedColumns).not.toContain("verifiedAt");
    expect(selectedColumns).not.toContain("matchId");
    expect(selectedColumns).not.toContain("createdAt");
    expect(selectedColumns).not.toContain("id");
  });
});
