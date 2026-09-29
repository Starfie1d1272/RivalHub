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
    expect(built.sql).toContain("ON lineup.match_id = m.id AND lineup.user_id = mps.user_id");
    expect(built.sql).not.toContain("mps.user_id IN");
  });

  it("projects confirmed DAK stats from official completed maps while the series remains in progress", async () => {
    let captured: unknown;
    const database = {
      execute: async (query: unknown) => {
        captured = query;
        return { rows: [] };
      },
    } as unknown as TxDb;

    await getStatsLeaderboard({}, ["00000000-0000-0000-0000-000000000005"], [], database, { requireCurrentImports: true });

    const built = new PgDialect().sqlToQuery(captured as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(built.sql).toContain("mm.score_a IS NOT NULL AND mm.score_b IS NOT NULL AND mm.completed_at IS NOT NULL");
    expect(built.sql).not.toContain("m.status =");
    expect(built.sql).not.toContain("m.is_forfeit");
  });
});
