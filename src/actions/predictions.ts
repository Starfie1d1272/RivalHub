"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { seasons, predictionScenarios } from "@/db/schema";
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
import { predictionBoard } from "@/lib/predictions/data";
import { loadBaseline } from "@/lib/predictions/baseline";
import {
  replaceSimulationChoice,
  simulateMajor,
} from "@/lib/predictions/simulator";
import { pickSchema, rulesSchema } from "@/lib/predictions/rules";
import {
  enablePredictionsInTx,
  joinPredictionsInTx,
  savePickInTx,
  stakeInTx,
  openPredictionWindowInTx,
  moderatePredictionsInTx,
  saveScenarioInTx,
} from "@/lib/predictions/service";
const id = z.guid();
const scope = z.object({ seasonId: id });
const choices = z
  .record(z.string().max(100), z.object({ a: id, b: id, winner: id }))
  .refine((v) => Object.keys(v).length <= 160, "推演选择过多");
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
  const p = scope.safeParse(input);
  if (!p.success) return failValidation("赛事参数无效");
  try {
    await publicSeason(p.data.seasonId);
    const user = await getUserSession();
    return ok(
      await db.transaction((tx) =>
        predictionBoard(tx, p.data.seasonId, user?.userId ?? null),
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
  scope.extend({
    operation: z.literal("stake"),
    marketId: id,
    side: id,
    amount: z.union([z.literal("all"), z.string().regex(/^[1-9]\d{0,14}$/)]),
    requestId: id,
  }),
]);
export async function mutatePrediction(input: unknown) {
  const p = spectatorInput.safeParse(input);
  if (!p.success) return failValidation("请求信息无效，请检查队伍和积分数量");
  try {
    const user = await requireAuth();
    const season = await publicSeason(p.data.seasonId);
    const args = { ...p.data, userId: user.userId };
    const receipt = await db.transaction(async (tx) => {
      if (args.operation === "join") return joinPredictionsInTx(tx, args);
      if (args.operation === "pick") return savePickInTx(tx, args);
      return stakeInTx(tx, args);
    });
    refresh(season.slug);
    return ok(receipt);
  } catch (e) {
    return actionError("predictions.mutate", e);
  }
}
const adminInput = z.discriminatedUnion("operation", [
  scope.extend({ operation: z.literal("enable"), rules: rulesSchema }),
  scope.extend({
    operation: z.literal("contest"),
    stageKey: z.string().min(1).max(60),
    deadline: z.iso.datetime({ offset: true }),
  }),
  scope.extend({
    operation: z.literal("market"),
    matchId: id,
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
      if (args.operation === "enable") await enablePredictionsInTx(tx, args);
      else if (args.operation === "contest" || args.operation === "market")
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
const simulateInput = scope.extend({
  choices,
  scenarioId: id.optional(),
  edit: z
    .object({
      stageKey: z.string().max(60),
      matchKey: z.string().max(30),
      winner: id,
    })
    .optional(),
});
async function simulationBase(seasonId: string, scenarioId?: string) {
  if (!scenarioId) return loadBaseline(db, seasonId);
  const [saved] = await db
    .select()
    .from(predictionScenarios)
    .where(eq(predictionScenarios.id, scenarioId));
  if (!saved || saved.seasonId !== seasonId)
    throw new AppError(ErrorCode.NOT_FOUND, "推演快照不存在");
  return saved.baseline;
}
export async function projectPrediction(input: unknown) {
  const p = simulateInput.safeParse(input);
  if (!p.success) return failValidation("推演参数无效");
  try {
    await publicSeason(p.data.seasonId);
    const base = await simulationBase(p.data.seasonId, p.data.scenarioId);
    let next = p.data.choices;
    if (p.data.edit) {
      const edit = p.data.edit;
      const match = simulateMajor(base, next)
        .find((s) => s.key === edit.stageKey)
        ?.matches.find((m) => m.key === edit.matchKey);
      if (!match)
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "对阵已变化，请重置最新赛况",
        );
      next = replaceSimulationChoice(
        base,
        next,
        edit.stageKey,
        match,
        edit.winner,
      );
    }
    return ok({ base, choices: next, stages: simulateMajor(base, next) });
  } catch (e) {
    return actionError("predictions.simulate", e);
  }
}
export async function savePredictionScenario(input: unknown) {
  const p = simulateInput
    .extend({
      name: z.string().trim().min(1).max(80),
      expectedRevision: z.string().length(64),
    })
    .safeParse(input);
  if (!p.success) return failValidation("请填写推演名称");
  try {
    const user = await requireAuth();
    await publicSeason(p.data.seasonId);
    const baseline = await simulationBase(p.data.seasonId, p.data.scenarioId);
    if (baseline.revision !== p.data.expectedRevision)
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "官方赛况已经变化，请重置为最新赛况、确认推演后再保存",
      );
    return ok(
      await db.transaction((tx) =>
        saveScenarioInTx(tx, { ...p.data, userId: user.userId, baseline }),
      ),
    );
  } catch (e) {
    return actionError("predictions.save_scenario", e);
  }
}
