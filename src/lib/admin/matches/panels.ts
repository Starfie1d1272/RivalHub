import "server-only";
import { db } from "@/db/client";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { readAdminMatchPanelFacts, readAdminMatchCommentary } from "./commentary";
import { loadAdminMatchOperations } from "./operations";

/** One request owns the full active universe; local filters never trim conflicts. */
export async function loadAdminMatchPanels(seasonId: string, historicalMatchIds: readonly string[]) {
  const admin = await requireSeasonAdmin(seasonId);
  const facts = await readAdminMatchPanelFacts(db, seasonId, historicalMatchIds);
  const commentary = await readAdminMatchCommentary(db, { seasonId, currentUserId: admin.userId, historicalMatchIds }, facts);
  const operations = await loadAdminMatchOperations(seasonId, commentary, facts);
  return { commentary, operations };
}
