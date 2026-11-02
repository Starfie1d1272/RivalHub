"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { actionError, failValidation } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { startSeasonInTx } from "@/lib/seasons/prestart";
import { ok, type ActionResult } from "@/types/action";

export async function startSeason(input: { seasonId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: z.guid() }).safeParse(input);
  if (!parsed.success) return failValidation("赛事标识无效");
  const admin = await requireSeasonAdmin(parsed.data.seasonId);
  try {
    const slug = await db.transaction(tx => startSeasonInTx(tx, parsed.data.seasonId, auditActorId(admin)));
    revalidateSeasonPaths(slug, ["adminDraft", "adminMatches", "matches", "teams"]);
    return ok(undefined);
  } catch (error) { return actionError("startSeason", error); }
}
