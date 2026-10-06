"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import {
  requireAuth,
  requireSeasonAdmin,
  getUserSession,
  auditActorId,
} from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/types/action";
import { loadBaseline } from "@/lib/predictions/baseline";
import { predictionBoard, publicPickEmBoard } from "@/lib/predictions/data";
import {
  pickSchema,
  rulesSchema,
  defaultPredictionRules,
} from "@/lib/predictions/rules";
import {
  enablePredictionsInTx,
  joinPredictionsInTx,
  savePickInTx,
  openPredictionWindowInTx,
  moderatePredictionsInTx,
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
  revalidatePath(`/admin/${slug}/predictions`);
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
const adminInput = z.discriminatedUnion("operation", [
  scope.extend({
    operation: z.literal("enable"),
    rules: z.object({
      silver: rulesSchema.shape.silver,
      gold: rulesSchema.shape.gold,
      diamond: rulesSchema.shape.diamond,
    }),
  }),
  scope.extend({
    operation: z.literal("contest"),
    stageKey: z.string().min(1).max(60),
    deadline: z.iso.datetime({ offset: true }),
  }),
  scope.extend({
    operation: z.literal("pause"),
    paused: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
  }),
  scope.extend({
    operation: z.literal("void"),
    contestId: id,
    reason: z.string().trim().min(1).max(1000),
  }),
]);
export async function administerPredictions(input: unknown) {
  const p = adminInput.safeParse(input);
  if (!p.success)
    return failValidation("配置无效，请检查规则、截止时间或操作理由");
  try {
    const admin = await requireSeasonAdmin(p.data.seasonId);
    const season = await publicSeason(p.data.seasonId);
    const args = { ...p.data, actorId: auditActorId(admin) };
    await db.transaction(async (tx) => {
      if (args.operation === "enable") {
        const base = await loadBaseline(tx, args.seasonId);
        if (!base.teams.length)
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            "请先确认 Main Event 名单与种子",
          );
        await enablePredictionsInTx(tx, {
          ...args,
          rules: { ...defaultPredictionRules(base.stages), ...args.rules },
        });
      } else if (args.operation === "contest")
        await openPredictionWindowInTx(tx, {
          ...args,
          deadline: new Date(args.deadline),
        });
      else await moderatePredictionsInTx(tx, args);
    });
    refresh(season.slug);
    return ok(undefined);
  } catch (e) {
    return actionError("predictions.admin", e);
  }
}
