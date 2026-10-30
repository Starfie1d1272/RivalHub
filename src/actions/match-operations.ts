"use server";
import { revalidatePath } from "next/cache";
import { revokeMizarInstallation } from "@/lib/mizar/installation";
import { z } from "zod";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { actionError, getMatchOrThrow, getSeasonOrThrow } from "@/lib/action-utils";
import { manualMapTakeoverSchema, takeOverCurrentMap } from "@/lib/mizar/source";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { ok } from "@/types/action";
import { closeCompletedSource, closeSourceSchema } from "@/lib/mizar/source-management";
import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@/lib/errors";

export async function takeOverMatchMap(matchId: string, expected: unknown) {
  try {
    const id = z.uuid().parse(matchId);
    const scope = manualMapTakeoverSchema.parse(expected);
    const match = await getMatchOrThrow(id);
    const session = await requireSeasonAdmin(match.seasonId);
    await takeOverCurrentMap(id, auditActorId(session), scope);
    const season = await getSeasonOrThrow(match.seasonId);
    revalidateMatchPaths(season.slug, id);
    return ok(undefined);
  } catch (error) { return actionError("takeOverMatchMap", error); }
}

export async function revokeMatchInstallation(seasonId: string, installationId: string, reason = "") {
  try {
    const id = z.uuid().parse(installationId);
    const competitionId = z.uuid().parse(seasonId);
    const session = await requireSeasonAdmin(competitionId);
    await revokeMizarInstallation(id, competitionId, auditActorId(session), z.string().max(500).parse(reason));
    const season = await getSeasonOrThrow(competitionId);
    revalidatePath(`/admin/${season.slug}/matches`);
    return ok(undefined);
  } catch (error) { return actionError("revokeMatchInstallation", error); }
}

export async function closeCompletedSources(seasonId: string, raw: unknown) {
  try {
    const competitionId = z.uuid().parse(seasonId);
    const inputs = z.array(closeSourceSchema).min(1).max(20).parse(raw);
    const actor = await requireSeasonAdmin(competitionId);
    const requestId = randomUUID();
    const results = [];
    for (const input of inputs) {
      try { results.push({ sessionId: input.sessionId, ...await closeCompletedSource(competitionId, actor.userId, input, requestId) }); }
      catch (error) {
        if (error instanceof AppError && error.code !== ErrorCode.INTERNAL_ERROR) results.push({ sessionId: input.sessionId, status: "blocked" as const, reason: error.message });
        else {
          const failure = actionError("closeCompletedSources.row", error);
          results.push({ sessionId: input.sessionId, status: "failed" as const, reason: failure.success ? "请刷新核对结果。" : failure.error.message });
        }
      }
    }
    return ok(results);
  } catch (error) { return actionError("closeCompletedSources", error); }
}
