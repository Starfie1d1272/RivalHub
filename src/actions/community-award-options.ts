"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { requireAuth } from "@/lib/auth/session";
import { actionError, failValidation } from "@/lib/action-utils";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getCommunityAwardFormOptions } from "@/lib/community-awards/data";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok, type ActionResult } from "@/types/action";

type Options = Awaited<ReturnType<typeof getCommunityAwardFormOptions>>;

export async function loadCommunityAwardOptions(input: unknown): Promise<ActionResult<Options>> {
  const parsed = z.string().min(1).max(160).safeParse(input);
  if (!parsed.success) return failValidation("赛事无效。");
  try {
    await requireAuth();
    const season = await getPublicOrAuthorizedDraftSeason(parsed.data);
    if (!season?.hasCommunityAwards) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
    return ok(await getCommunityAwardFormOptions(db, season.id, normalizeStagePlan(season.stagePlan)));
  } catch (error) {
    return actionError("loadCommunityAwardOptions", error);
  }
}
