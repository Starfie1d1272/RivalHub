"use server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { publicBetTag } from "@/lib/cache/tags";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireAuth, getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/types/action";
import {
  readFreePredictionSnapshot,
  projectFreePredictionBoard,
} from "@/lib/free-predictions/data";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";
const scope = z.object({ seasonId: z.guid() });
async function publicSeason(seasonId: string) {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, seasonId) });
  if (
    !season ||
    season.competitionTemplate !== "major" ||
    !(await getPublicOrAuthorizedDraftSeason(season.slug))
  )
    throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在");
  return season;
}
export async function submitFreePrediction(input: unknown) {
  const p = scope
    .extend({
      matchId: z.guid(),
      kind: z.enum(["result", "bp"]),
      selection: z.array(z.string().min(1).max(100)).min(1).max(5),
      requestId: z.guid(),
    })
    .safeParse(input);
  if (!p.success) return failValidation("预测参数无效");
  try {
    const user = await requireAuth();
    const season = await publicSeason(p.data.seasonId);
    const receipt = await db.transaction((tx) =>
      submitFreePredictionInTx(tx, { ...p.data, userId: user.userId }),
    );
    try {
      updateTag(publicBetTag(season.id));
      revalidatePath(`/${season.slug}/bet`);
      revalidatePath(`/${season.slug}/matches/${p.data.matchId}`);
    } catch (error) {
      actionError("free_predictions.postcommit_refresh", error);
    }
    return ok(receipt);
  } catch (e) {
    return actionError("free_predictions.submit", e);
  }
}

/** A free-vote refresh never loads financial accounts, markets or pools. */
export async function getFreePredictionMatch(input: unknown) {
  const parsed = scope.extend({ matchId: z.guid() }).strict().safeParse(input);
  if (!parsed.success) return failValidation("比赛参数无效");
  try {
    await publicSeason(parsed.data.seasonId);
    const user = await getUserSession();
    const snapshot = await db.transaction(
      (tx) =>
        readFreePredictionSnapshot(tx, parsed.data.seasonId, user?.userId ?? null, {
          matchId: parsed.data.matchId,
        }),
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
    return ok(
      projectFreePredictionBoard(snapshot).matches.find(
        (match) => match.matchId === parsed.data.matchId,
      ) ?? null,
    );
  } catch (error) {
    return actionError("free_predictions.match", error);
  }
}
