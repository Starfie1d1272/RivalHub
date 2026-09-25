"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import {
  configureCompetitionQualificationRunInTx,
  generateCompetitionQualificationRoundInTx,
  previewCompetitionQualificationRoundInTx,
  resetCompetitionQualificationRunInTx,
  saveCompetitionQualificationRankInTx,
} from "@/lib/competition-qualification/runtime";
import { revalidateSeasonPaths, updatePublicHomeTag } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";

const uuid = z.guid();

function revalidatePrestart(seasonSlug: string): void {
  updatePublicHomeTag();
  revalidatePath(`/admin/${seasonSlug}`);
  revalidatePath(`/admin/${seasonSlug}/prestart`);
  revalidateSeasonPaths(seasonSlug, ["matches"]);
}

async function adminOrThrow(seasonId: string) {
  const admin = await requireSeasonAdmin(seasonId);
  return { admin, actorId: auditActorId(admin) };
}

export async function configureCompetitionQualification(input: {
  seasonId: string;
  format: "direct_bo3" | "short_swiss_2w2l";
  preliminaryOrderEntryIds: string[];
}): Promise<ActionResult<void>> {
  const parsed = z.object({
    seasonId: uuid,
    format: z.enum(["direct_bo3", "short_swiss_2w2l"]),
    preliminaryOrderEntryIds: z.array(uuid).min(2).max(128),
  }).safeParse(input);
  if (!parsed.success || new Set(parsed.data.preliminaryOrderEntryIds).size !== parsed.data.preliminaryOrderEntryIds.length) {
    return failValidation("Play-in 配置或预排名无效。");
  }
  try {
    const { actorId } = await adminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => configureCompetitionQualificationRunInTx(tx, { ...parsed.data, actorId }));
    revalidatePrestart(result.seasonSlug);
    return ok(undefined);
  } catch (error) { return actionError("configureCompetitionQualification", error); }
}

export async function saveCompetitionQualificationRank(input: {
  seasonId: string;
  entryId: string;
  nextRank: number;
}): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, entryId: uuid, nextRank: z.number().int().min(1).max(128) }).safeParse(input);
  if (!parsed.success) return failValidation("Play-in 预排名无效。");
  try {
    const { actorId } = await adminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => saveCompetitionQualificationRankInTx(tx, { ...parsed.data, actorId }));
    revalidatePrestart(result.seasonSlug);
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitionQualificationRank", error); }
}

export async function previewCompetitionQualificationRound(input: { seasonId: string; runId: string }) {
  const parsed = z.object({ seasonId: uuid, runId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("Play-in 轮次参数无效。");
  try {
    await adminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => previewCompetitionQualificationRoundInTx(tx, parsed.data));
    return ok(result);
  } catch (error) { return actionError("previewCompetitionQualificationRound", error); }
}

export async function generateCompetitionQualificationRound(input: {
  seasonId: string;
  runId: string;
  expectedPairings: Array<{ higherSeedTeamId: string; lowerSeedTeamId: string }>;
}): Promise<ActionResult<{ round: number; matchCount: number; created: boolean }>> {
  const parsed = z.object({
    seasonId: uuid,
    runId: uuid,
    expectedPairings: z.array(z.object({ higherSeedTeamId: uuid, lowerSeedTeamId: uuid })).min(1).max(128),
  }).safeParse(input);
  if (!parsed.success) return failValidation("Play-in 轮次参数无效。");
  try {
    const { actorId } = await adminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => generateCompetitionQualificationRoundInTx(tx, { ...parsed.data, actorId }));
    revalidatePrestart(result.seasonSlug);
    return ok({ round: result.round, matchCount: result.matchCount, created: result.created });
  } catch (error) { return actionError("generateCompetitionQualificationRound", error); }
}

export async function resetCompetitionQualification(input: { seasonId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("赛季标识无效。");
  try {
    const { actorId } = await adminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => resetCompetitionQualificationRunInTx(tx, { ...parsed.data, actorId }));
    revalidatePrestart(result.seasonSlug);
    return ok(undefined);
  } catch (error) { return actionError("resetCompetitionQualification", error); }
}
