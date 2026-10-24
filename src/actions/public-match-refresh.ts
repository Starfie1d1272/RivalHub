"use server";

import { traceOperation } from "@/lib/observability/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
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
    if ("matchId" in scope) {
      const match = await db.query.matches.findFirst({
        where: and(eq(matches.id, scope.matchId), eq(matches.seasonId, season.id)), columns: { id: true },
      });
      if (!match) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
    }
    return ok(await traceOperation("match.refresh", { scope: "match", operation: "public_token", stage: "read" }, () => loadPublicMatchRefreshToken(season.id, scope)));
  } catch (error) {
    return actionError("readPublicMatchRefreshToken", error);
  }
}
