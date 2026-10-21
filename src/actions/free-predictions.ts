"use server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { publicBetTag } from "@/lib/cache/tags";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/types/action";
import { readFreePredictionRanking } from "@/lib/free-predictions/ranking";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";
const scope = z.object({seasonId:z.guid()});
async function publicSeason(seasonId:string) {
  const season=await db.query.seasons.findFirst({where:eq(seasons.id,seasonId)});
  if(!season || season.competitionTemplate!=="major" || !await getPublicOrAuthorizedDraftSeason(season.slug)) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  return season;
}
export async function getFreePredictionRanking(input:unknown) {
  const p=scope.extend({sort:z.enum(["profit","hits","accuracy"]),userIds:z.array(z.guid()).max(200).optional()}).safeParse(input);
  if(!p.success)return failValidation("排行参数无效");
  try {await publicSeason(p.data.seasonId);return ok(await db.transaction(tx=>readFreePredictionRanking(tx,p.data.seasonId,p.data.sort,p.data.userIds),{accessMode:"read only",isolationLevel:"repeatable read"}));}catch(e){return actionError("free_predictions.ranking",e);}
}
export async function submitFreePrediction(input:unknown) {
  const p=scope.extend({matchId:z.guid(),kind:z.enum(["result","bp"]),selection:z.array(z.string().min(1).max(100)).min(1).max(5),requestId:z.guid()}).safeParse(input);
  if(!p.success)return failValidation("预测参数无效");
  try {const user=await requireAuth();const season=await publicSeason(p.data.seasonId);const receipt=await db.transaction(tx=>submitFreePredictionInTx(tx,{...p.data,userId:user.userId}));updateTag(publicBetTag(season.id));revalidatePath(`/${season.slug}/bet`);revalidatePath(`/${season.slug}/matches/${p.data.matchId}`);return ok(receipt);}catch(e){return actionError("free_predictions.submit",e);}
}
