import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../../../src/db/client";
import { seasons } from "../../../src/db/schema";

/** Rebuild public participation windows; never import viewer picks, accounts or credits. */
export async function initializePreviewPickEm(database: DB): Promise<void> {
  const { syncAutomaticPickEmInTx } = await import("../../../src/lib/predictions/service");
  const events = await database.select({ id: seasons.id }).from(seasons)
    .where(and(eq(seasons.competitionTemplate, "major"), inArray(seasons.status, ["registration", "playing"])));
  for (const event of events) {
    await database.transaction((tx) => syncAutomaticPickEmInTx(tx, event.id));
  }
}
