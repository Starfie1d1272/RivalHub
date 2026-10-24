"use server";

import { z } from "zod";
import { actionError } from "@/lib/action-utils";
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
