import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const selectionMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ db: { transaction: transactionMock } }));
vi.mock("@/lib/stats/tournament-query", () => ({ getCurrentStatsSelectionInTx: selectionMock }));

import { getPublicPlayerMapExperienceContext, getVerifiedPlayerStatsBySeason } from "@/lib/stats/public-query";

describe("getVerifiedPlayerStatsBySeason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectionMock.mockResolvedValue({ currentImportIds: ["current-import"] });
    transactionMock.mockImplementation((run) => run({ execute: executeMock }));
  });

  it("only projects administrator-verified stats from finished matches", async () => {
    executeMock.mockResolvedValue({
      rows: [{ user_id: "player-1", maps: "2", avg_rating: "1.15", avg_adr: "82.4", avg_kd: "1.22" }],
    });

    const stats = await getVerifiedPlayerStatsBySeason("season-1", ["player-1"]);
    const query = new PgDialect().sqlToQuery(executeMock.mock.calls[0]?.[0]);

    expect(query.sql).toContain("m.status = 'finished'");
    expect(query.sql).toContain("mm.completed_at IS NOT NULL");
    expect(query.sql).toContain("mps.dak_import_id IS NULL OR mps.dak_import_id IN");
    expect(query.params).toContain("current-import");
    expect(selectionMock).toHaveBeenCalledWith({ execute: executeMock }, { seasonId: "season-1", userIds: ["player-1"] });
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(stats.get("player-1")).toEqual({ maps: 2, avgRating: 1.15, avgAdr: 82.4, avgKd: 1.22 });
  });

  it("retains independently verified OCR observations when no DAK lineage is valid", async () => {
    selectionMock.mockResolvedValue({ currentImportIds: [] });
    executeMock.mockResolvedValue({ rows: [] });

    await getVerifiedPlayerStatsBySeason("season-1");

    const query = new PgDialect().sqlToQuery(executeMock.mock.calls[0]?.[0]);
    expect(query.sql).toContain("AND mps.dak_import_id IS NULL");
    expect(query.sql).not.toContain("dak_import_id IN");
  });

  it("derives map experience and member coverage from one filtered observation set", async () => {
    executeMock.mockResolvedValue({ rows: [
      { map_name: "de_nuke", samples: "3", players: "2", player_ids: ["p1", "p2"], rating: "1.1", adr: "80", kd: "1.2" },
      { map_name: "de_mirage", samples: "1", players: "1", player_ids: ["p1"], rating: null, adr: null, kd: null },
    ] });

    const context = await getPublicPlayerMapExperienceContext(["p1", "p2", "p1"]);

    expect(context.experiencedMemberIds).toEqual(["p1", "p2"]);
    expect(context.experience[0]).toEqual({ mapName: "de_nuke", samples: 3, players: 2, rating: 1.1, adr: 80, kd: 1.2 });
    expect(selectionMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
