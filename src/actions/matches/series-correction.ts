"use server";

import { db } from "@/db/client";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { actionError, getMatchOrThrow, getSeasonOrThrow } from "@/lib/action-utils";
import { ok, type ActionResult } from "@/types/action";
import { revalidateMatchPaths, updatePublicSeasonTags } from "@/lib/revalidation";
import { revalidatePath } from "next/cache";
import { seriesCorrectionRequestSchema, seriesCorrectionConfirmationSchema, planSeriesAfterMapScoreChangeInTx, correctSeriesAfterMapScoreChangeInTx, type SeriesCorrectionPreview } from "@/lib/matches/series-score-correction";

export async function previewSeriesMapCorrection(raw: unknown): Promise<ActionResult<SeriesCorrectionPreview | null>> {
  try {
    const input = seriesCorrectionRequestSchema.parse(raw);
    const match = await getMatchOrThrow(input.matchId);
    await requireSeasonAdmin(match.seasonId);
    return ok(await db.transaction(tx => planSeriesAfterMapScoreChangeInTx(tx, input)));
  } catch (error) { return actionError("previewSeriesMapCorrection", error); }
}

export async function confirmSeriesMapCorrection(raw: unknown): Promise<ActionResult<void>> {
  try {
    const input = seriesCorrectionConfirmationSchema.parse(raw);
    const match = await getMatchOrThrow(input.matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    const season = await getSeasonOrThrow(match.seasonId);
    const result = await db.transaction(tx => correctSeriesAfterMapScoreChangeInTx(tx, input, auditActorId(admin)));
    revalidateMatchPaths(season.slug, match.id);
    if (result.finishedSlug) {
      updatePublicSeasonTags(result.finishedSlug, match.seasonId);
      revalidatePath(`/${result.finishedSlug}`);
    }
    return ok(undefined);
  } catch (error) { return actionError("confirmSeriesMapCorrection", error); }
}
