import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { loadParticipantQualificationFacts, loadParticipantQualificationRawBundle, projectParticipantQualificationFacts } from "@/lib/qualification/service";
import { createLocalPool } from "./harness/database";

describe("qualification raw bundle on the caller's PostgreSQL executor", () => {
  it("projects independent primary/fallback facts and chronology without further SQL", async () => {
    const pool = createLocalPool({ max: 1 });
    const userId = randomUUID();
    let queries = 0;
    const database = drizzle(pool, { schema, logger: { logQuery() { queries++; } } });
    try {
      await database.transaction(async tx => {
        await tx.insert(schema.users).values({ id: userId, email: `${userId}@local.test`, displayName: "Synthetic qualification" });
        await tx.insert(schema.competitiveRankFacts).values([
          { userId, platform: "perfect_world", kind: "historical_peak", rank: "A", rating: "1.25", stars: null },
          { userId, platform: "fivee", kind: "historical_peak", rank: "B", rating: "2.50", stars: null },
          { userId, platform: "fivee", kind: "season_peak", platformSeasonKey: "fixture", status: "unranked", rank: null, rating: null },
        ]);
        queries = 0;
        expect(await loadParticipantQualificationRawBundle([], { executor: tx })).toEqual({ userRows: [], verificationRows: [], rankRows: [], platformSeasonRows: [] });
        expect(queries).toBe(0);
        const bundle = await loadParticipantQualificationRawBundle([userId, userId], { executor: tx });
        expect(queries).toBe(4);
        const beforeProjection = queries;
        const perfect = projectParticipantQualificationFacts(bundle, { platform: "perfect_world", fallbackPlatform: "fivee" });
        const fivee = projectParticipantQualificationFacts(bundle, { platform: "fivee" });
        expect(queries).toBe(beforeProjection);
        expect(perfect.get(userId)?.historicalPeak).toMatchObject({ rank: "A", rating: 1.25, sourcePlatform: "perfect_world" });
        expect(perfect.get(userId)?.fallbackFacts?.historicalPeak).toMatchObject({ rank: "B", rating: 2.5 });
        expect(fivee.get(userId)?.seasonPeaks?.get("fixture")).toMatchObject({ status: "unranked", rank: null, rating: null });
        expect(perfect.get(userId)?.seasonPeaks?.has("fixture")).toBe(false);
        expect(perfect).toEqual(await loadParticipantQualificationFacts([userId], { executor: tx, platform: "perfect_world", fallbackPlatform: "fivee" }));
        expect(fivee).toEqual(await loadParticipantQualificationFacts([userId], { executor: tx, platform: "fivee" }));
        // Force rollback: only isolated synthetic fixture facts are used.
        throw new Error("fixture rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "fixture rollback") throw error;
    } finally { await pool.end(); }
  });
});
