"use server";
import { revalidatePath } from "next/cache";
import { revokeMizarInstallation } from "@/lib/mizar/installation";
import { z } from "zod";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { actionError, getMatchOrThrow, getSeasonOrThrow } from "@/lib/action-utils";
import { manualMapTakeoverSchema, takeOverCurrentMap } from "@/lib/mizar/source";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { ok } from "@/types/action";

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

export async function revokeMatchInstallation(seasonId: string, installationId: string) {
  try {
    const id = z.uuid().parse(installationId);
    const competitionId = z.uuid().parse(seasonId);
    const session = await requireSeasonAdmin(competitionId);
    await revokeMizarInstallation(id, competitionId, auditActorId(session));
    const season = await getSeasonOrThrow(competitionId);
    revalidatePath(`/admin/${season.slug}/matches`);
    return ok(undefined);
  } catch (error) { return actionError("revokeMatchInstallation", error); }
}
