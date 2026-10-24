"use server";

import { z } from "zod";
import { actionError } from "@/lib/action-utils";
import { readAdminDemoReview } from "@/lib/admin/matches/demo-review-read";
import { readAdminDemoQuality } from "@/lib/admin/matches/demo-quality-read";
import { loadMatchResources } from "@/lib/admin/matches/resources";
import { loadAdminCommentaryEffectiveness } from "@/lib/admin/matches/overview";
import { ok } from "@/types/action";

export async function readMatchResources(seasonId: string) {
  try {
    return ok(await loadMatchResources(z.uuid().parse(seasonId)));
  } catch (error) { return actionError("readMatchResources", error); }
}

export async function readCommentaryEffectiveness(seasonId: string) {
  try {
    return ok(await loadAdminCommentaryEffectiveness(z.uuid().parse(seasonId)));
  } catch (error) { return actionError("readCommentaryEffectiveness", error); }
}

export async function readMatchDemoQuality(input: unknown) {
  try {
    const scope = z.object({ seasonId: z.uuid(), matchId: z.uuid(), mapId: z.uuid(), importId: z.uuid() }).parse(input);
    return ok(await readAdminDemoQuality(scope));
  } catch (error) { return actionError("readMatchDemoQuality", error); }
}

export async function readMatchDemoReview(input: unknown) {
  try {
    const scope = z.object({ seasonId: z.uuid(), matchId: z.uuid(), mapId: z.uuid(), importId: z.uuid() }).parse(input);
    return ok(await readAdminDemoReview(scope));
  } catch (error) { return actionError("readMatchDemoReview", error); }
}
