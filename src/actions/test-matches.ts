"use server";

import { z } from "zod";
import { and, eq, ilike, or } from "drizzle-orm";
import { users, steamProfiles } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { db } from "@/db/client";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { actionError, getMatchOrThrow, getSeasonOrThrow } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { revalidateMatchPaths, updatePublicSeasonTags } from "@/lib/revalidation";
import { revalidatePath } from "next/cache";
import { ok } from "@/types/action";
import { createTestMatchInTx, testMatchInput } from "@/lib/matches/test-matches";
import { concludeUnassociatedMatchInTx, supplementUnassociatedResultInTx, correctUnassociatedResultInTx } from "@/lib/matches/unassociated-result";

export async function searchTestMatchOperators(seasonId: string, query: string) {
  try {
    z.uuid().parse(seasonId);
    await requireSeasonAdmin(seasonId);
    const search = z.string().trim().min(2).max(80).parse(query);
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await db.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName })
      .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(and(or(ilike(users.displayName, pattern), ilike(users.perfectName, pattern), ilike(steamProfiles.personaName, pattern))))
      .orderBy(users.id).limit(20);
    return ok(rows.map(row => ({ id: row.id, name: getPublicDisplayName(row) })));
  } catch (error) { return actionError("searchTestMatchOperators", error); }
}

export async function createTestMatch(input: unknown) {
  try {
    const values = testMatchInput.parse(input);
    const admin = await requireSeasonAdmin(values.seasonId);
    const result = await db.transaction(tx => createTestMatchInTx(tx, values, admin.userId));
    updatePublicSeasonTags(result.seasonSlug, values.seasonId, { statistics: false });
    revalidatePath(`/admin/${result.seasonSlug}/test-matches`);
    revalidatePath("/my/competitions");
    return ok(result);
  } catch (error) { return actionError("createTestMatch", error); }
}

const conclusionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("recorded"), scoreA: z.number().int().min(0).max(3), scoreB: z.number().int().min(0).max(3) }).strict(),
  z.object({ kind: z.literal("pending") }).strict(), z.object({ kind: z.literal("omitted") }).strict(),
]);
export async function concludeTestMatch(matchId: string, input: unknown, correction?: { expectedUpdatedAt: string; reason: string; maps?: { mapId: string; scoreA: number; scoreB: number }[] }) {
  try {
    z.uuid().parse(matchId);
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    if (!match.testConfig) throw new AppError(ErrorCode.FORBIDDEN, "此入口仅用于测试赛。");
    const conclusion = conclusionSchema.parse(input);
    const review = correction ? z.object({ expectedUpdatedAt: z.iso.datetime(), reason: z.string().trim().min(1).max(1000), maps: z.array(z.object({ mapId: z.uuid(), scoreA: z.number().int().min(0), scoreB: z.number().int().min(0) }).strict()).max(5).optional() }).strict().parse(correction) : null;
    await db.transaction(tx => review
      ? correctUnassociatedResultInTx(tx, { matchId, actorId: admin.userId, conclusion, expectedUpdatedAt: new Date(review.expectedUpdatedAt), reason: review.reason, maps: review.maps })
      : match.status === "finished"
      ? supplementUnassociatedResultInTx(tx, { matchId, actorId: admin.userId, conclusion })
      : concludeUnassociatedMatchInTx(tx, { matchId, actorId: admin.userId, conclusion }));
    const season = await getSeasonOrThrow(match.seasonId);
    revalidateMatchPaths(season.slug, matchId);
    revalidatePath(`/admin/${season.slug}/test-matches`);
    revalidatePath("/my/competitions");
    return ok(undefined);
  } catch (error) { return actionError("concludeTestMatch", error); }
}
