import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ db: { execute: executeMock } }));

import { getVerifiedPlayerStatsBySeason } from "@/lib/stats/public-query";

describe("getVerifiedPlayerStatsBySeason", () => {
  it("only projects administrator-verified stats from finished matches", async () => {
    executeMock.mockResolvedValue({
      rows: [{ user_id: "player-1", maps: "2", avg_rating: "1.15", avg_adr: "82.4", avg_kd: "1.22" }],
    });

    const stats = await getVerifiedPlayerStatsBySeason("season-1", ["player-1"]);
    const query = new PgDialect().sqlToQuery(executeMock.mock.calls[0]?.[0]);

    expect(query.sql).toContain("m.status = 'finished'");
    expect(stats.get("player-1")).toEqual({ maps: 2, avgRating: 1.15, avgAdr: 82.4, avgKd: 1.22 });
  });
});
