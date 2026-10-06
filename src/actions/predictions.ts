"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { requireAuth, getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/types/action";
import { predictionBoard, publicPickEmBoard } from "@/lib/predictions/data";
import { pickSchema } from "@/lib/predictions/rules";
import {
  joinPredictionsInTx,
  savePickInTx,
} from "@/lib/predictions/service";
const id = z.guid();
const scope = z.object({ seasonId: id });
async function publicSeason(seasonId: string) {
  const [row] = await db
    .select({ slug: seasons.slug })
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  if (!row || !(await getPublicOrAuthorizedDraftSeason(row.slug)))
    throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在");
  return row;
}
function refresh(slug: string) {
  revalidatePath(`/${slug}/predictions`);
}
export async function getPredictionBoard(input: unknown) {
  const p = scope
    .extend({ view: z.enum(["sim", "record"]).default("sim") })
    .safeParse(input);
  if (!p.success) return failValidation("赛事参数无效");
  try {
    await publicSeason(p.data.seasonId);
    const user = await getUserSession();
    return ok(
      await db.transaction(
        (tx) =>
          predictionBoard(
            tx,
            p.data.seasonId,
            user?.userId ?? null,
            p.data.view,
          ).then(publicPickEmBoard),
        { accessMode: "read only", isolationLevel: "repeatable read" },
      ),
    );
  } catch (e) {
    return actionError("predictions.read", e);
  }
}
const spectatorInput = z.discriminatedUnion("operation", [
  scope.extend({ operation: z.literal("join") }),
  scope.extend({
    operation: z.literal("pick"),
    contestId: id,
    pick: pickSchema,
    submitted: z.boolean(),
    requestId: id,
  }),
]);
export async function mutatePrediction(input: unknown) {
  const p = spectatorInput.safeParse(input);
  if (!p.success) return failValidation("请求信息无效，请检查预测队伍");
  try {
    const user = await requireAuth();
    const season = await publicSeason(p.data.seasonId);
    const args = { ...p.data, userId: user.userId };
    const receipt = await db.transaction(async (tx) => {
      if (args.operation === "join") return joinPredictionsInTx(tx, args);
      return savePickInTx(tx, args);
    });
    refresh(season.slug);
    return ok(receipt);
  } catch (e) {
    return actionError("predictions.mutate", e);
  }
}
