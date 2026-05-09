import { and, count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import type { StageExecutor } from "./types";

export const doubleElimExecutor: StageExecutor = {
  async initialize() {
    throw new Error("double_elim initialize is orchestrated by initializeStage");
  },

  async isComplete(seasonId, stageKey) {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(matches)
      .where(and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)));
    if (total === 0) return false;

    const [{ value: active }] = await db
      .select({ value: count() })
      .from(matches)
      .where(
        and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, stageKey),
          sql`${matches.status} in ('scheduled', 'in_progress')`,
        ),
      );
    return active === 0;
  },
};
