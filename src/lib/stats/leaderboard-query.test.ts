import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { TxDb } from "@/db/client";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { getStatsLeaderboard } from "./leaderboard-query";

describe("getStatsLeaderboard roster scoping", () => {
  it("can require every stats row to resolve through the supplied team roster", async () => {
    let captured: unknown;
    const database = {
      execute: async (query: unknown) => {
        captured = query;
        return { rows: [] };
      },
    } as unknown as TxDb;
    const roster = [{
      matchId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002",
      entryId: "00000000-0000-0000-0000-000000000003",
    }] as EffectiveMatchRosterPlayer[];

    await getStatsLeaderboard(
      {},
      ["00000000-0000-0000-0000-000000000004"],
      roster,
      database,
      { groupByTeam: false, requireCurrentImports: true, requireRosterMatch: true },
    );

    const built = new PgDialect().sqlToQuery(captured as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(built.sql).toContain("lineup.entry_id IS NOT NULL");
  });
});
