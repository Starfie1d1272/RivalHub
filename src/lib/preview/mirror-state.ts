import "server-only";

import { eq } from "drizzle-orm";
import { boolean, char, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { db } from "@/db/client";

// Target-only table: deliberately outside src/db/schema so drizzle migrations
// never attempt to create or drop it in production.
const previewMirrorState = pgTable("preview_mirror_state", {
  id: boolean("id").primaryKey(),
  sourceTag: text("source_tag").notNull(),
  sourceCommit: char("source_commit", { length: 40 }).notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
  personaCount: integer("persona_count").notNull(),
  assetCount: integer("asset_count").notNull(),
});

export type PreviewMirrorIdentity = {
  sourceTag: string;
  sourceCommit: string;
  refreshedAt: Date;
  personaCount: number;
  assetCount: number;
};

export async function readPreviewMirrorIdentity(): Promise<PreviewMirrorIdentity | null> {
  try {
    const row = (await db.select({ sourceTag: previewMirrorState.sourceTag, sourceCommit: previewMirrorState.sourceCommit, refreshedAt: previewMirrorState.refreshedAt, personaCount: previewMirrorState.personaCount, assetCount: previewMirrorState.assetCount }).from(previewMirrorState).where(eq(previewMirrorState.id, true)).limit(1))[0];
    return row ?? null;
  } catch {
    return null;
  }
}
