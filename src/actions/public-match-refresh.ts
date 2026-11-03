"use server";

import { z } from "zod";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { loadPublicMatchRefreshToken } from "@/lib/matches/public-refresh";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok, type ActionResult } from "@/types/action";

const inputSchema = z.object({ seasonSlug: z.string().min(1).max(160), scope: z.union([
  z.object({ matchId: z.guid() }).strict(), z.object({ stage: z.string().min(1).max(100) }).strict(),
]) }).strict();

export async function readPublicMatchRefreshToken(input: unknown): Promise<ActionResult<string>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failValidation("比赛范围无效。");
  try {
    const { seasonSlug, scope } = parsed.data;
    const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
    if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
    const token = await loadPublicMatchRefreshToken(season.id, scope);
    if (token === null) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
    return ok(token);
  } catch (error) {
    return actionError("readPublicMatchRefreshToken", error);
  }
}
