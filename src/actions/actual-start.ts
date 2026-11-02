"use server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { actionError, failValidation } from "@/lib/action-utils";
import { adoptActualStartInTx, readActualStartImpact, readActualStartSnapshot } from "@/lib/matches/actual-start";
import { ok } from "@/types/action";

const scope = z.object({ seasonId: z.guid(), matchId: z.guid(), actualAt: z.iso.datetime({ offset: true }) }).strict();
const adoption = scope.extend({ requestId: z.guid(), expectedRevision: z.number().int().nonnegative(), expectedOriginal: z.string().nullable(), reason: z.string().trim().min(1).max(500), evidence: z.string().trim().min(1).max(500) });
export async function previewActualStart(input: unknown) {
  const parsed = scope.safeParse(input);
  if (!parsed.success) return failValidation("请填写有效的实际开局时间。");
  try {
    await requireSeasonAdmin(parsed.data.seasonId);
    const [match] = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.id, parsed.data.matchId), eq(matches.seasonId, parsed.data.seasonId)));
    if (!match) return failValidation("比赛不属于当前赛事。");
    const snapshot = await readActualStartSnapshot(db, match.id);
    return ok(await readActualStartImpact(db, match.id, parsed.data.actualAt, snapshot?.adopted ?? snapshot?.original ?? null));
  } catch (error) { return actionError("match.actual_start.preview", error); }
}
export async function adoptActualStart(input: unknown) {
  const parsed = adoption.safeParse(input);
  if (!parsed.success) return failValidation("请检查时间、原因与证据来源。");
  try {
    const admin = await requireSeasonAdmin(parsed.data.seasonId);
    const impact = await db.transaction(tx => adoptActualStartInTx(tx, { ...parsed.data, actorId: auditActorId(admin) }));
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, parsed.data.seasonId));
    if (season) revalidatePath(`/admin/${season.slug}/matches/${parsed.data.matchId}`);
    return ok(impact);
  } catch (error) { return actionError("match.actual_start.adopt", error); }
}
