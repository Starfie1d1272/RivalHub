"use server";
import { recordingReadbackVersion, type RecordingReadback } from "@/lib/matches/operation-readback";
import { recordingInput } from "@/lib/postmatch/recording-types";
import { mutateMatchRecordingInTx } from "@/lib/postmatch/service";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { addMatchCommentatorInTx, cancelMatchCommentaryInTx, claimMatchCommentaryInTx, removeMatchCommentatorInTx, revokePostMatchSubmissionInTx, setMatchVideoUrlInTx, submitPostMatchReportInTx } from "@/lib/postmatch/service";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { isHttpUrl } from "@/lib/external-url";
import { captureException, traceOperation } from "@/lib/observability/server";
import { revalidateMatchPaths } from "@/lib/revalidation";
const uuid = z.guid();
const url = z.string().trim().max(2000).refine(isHttpUrl, "录像链接必须是 http 或 https URL");
async function matchAndAdminOrThrow(matchId: string) {
  const [row] = await db.select({ id: matches.id, seasonId: matches.seasonId, slug: seasons.slug })
    .from(matches).leftJoin(seasons, eq(seasons.id, matches.seasonId)).where(eq(matches.id, matchId)).limit(1);
  if (!row?.seasonId) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  if (!row.slug) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");
  return { match: { id: row.id, seasonId: row.seasonId }, season: { slug: row.slug }, admin: await requireSeasonAdmin(row.seasonId) };
}
async function run(matchId: string, work: (actorId: string) => Promise<void>): Promise<ActionResult<{ refreshPending: boolean }>> {
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(matchId);
    await traceOperation("postmatch.commit", { scope: "action", operation: "postmatch.commit", stage: "transaction" }, () => work(auditActorId(admin)));
    let refreshPending = false;
    try { revalidateMatchPaths(season.slug, match.id, { statistics: false }); }
    catch (error) {
      refreshPending = true;
      captureException("action.postmatch_refresh_failure", error, { scope: "action", operation: "postmatch.refresh" });
    }
    return ok({ refreshPending });
  } catch (error) { return actionError("postmatch", error); }
}
/** Fresh authorization and invalidation only; no postmatch command is repeated. */
export async function retryPostMatchRefresh(matchId: string): Promise<ActionResult<void>> {
  try {
    const { match, season } = await matchAndAdminOrThrow(matchId);
    revalidateMatchPaths(season.slug, match.id, { statistics: false });
    return ok(undefined);
  } catch (error) { return actionError("retryPostMatchRefresh", error); }
}
export async function addMatchCommentator(input: unknown) { const p = z.object({ matchId: uuid, userId: uuid }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => addMatchCommentatorInTx(tx, { ...p.data, actorId })); }) : failValidation("解说参数无效。"); }
export async function claimMatchCommentary(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ matchId: uuid }).strict().safeParse(input);
  if (!parsed.success) return failValidation("认领比赛参数无效。");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    await db.transaction((tx) => claimMatchCommentaryInTx(tx, { matchId: match.id, userId: admin.userId }));
    revalidateMatchPaths(season.slug, match.id, { statistics: false });
    return ok(undefined);
  } catch (error) {
    return actionError("postmatch", error);
  }
}
export async function cancelMatchCommentary(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ matchId: uuid }).strict().safeParse(input);
  if (!parsed.success) return failValidation("取消认领参数无效。");
  try {
    const { match, season, admin } = await matchAndAdminOrThrow(parsed.data.matchId);
    await db.transaction((tx) => cancelMatchCommentaryInTx(tx, { matchId: match.id, userId: admin.userId }));
    revalidateMatchPaths(season.slug, match.id, { statistics: false });
    return ok(undefined);
  } catch (error) {
    return actionError("postmatch", error);
  }
}
export async function removeMatchCommentator(input: unknown) { const p = z.object({ matchId: uuid, userId: uuid }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => removeMatchCommentatorInTx(tx, { ...p.data, actorId })); }) : failValidation("解说参数无效。"); }
export async function updateMatchVideoUrl(input: unknown) { const p = z.object({ matchId: uuid, videoUrl: z.union([url, z.literal(""), z.null()]).optional() }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => setMatchVideoUrlInTx(tx, { matchId: p.data.matchId, videoUrl: p.data.videoUrl || null, actorId })); }) : failValidation("录像链接无效。"); }
export async function submitPostMatchReport(input: unknown) { const p = z.object({ matchId: uuid }).strict().safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId: p.data.matchId, actorId })); }) : failValidation("赛后提交参数无效。"); }
export async function revokePostMatchSubmission(input: unknown) {
  const parsed = z.object({ matchId: uuid, reason: z.string().trim().max(500).optional() }).strict().safeParse(input);
  if (!parsed.success) return failValidation("撤销提交参数无效，原因最多 500 字。");
  return run(parsed.data.matchId, async (actorId) => {
    await db.transaction((tx) => revokePostMatchSubmissionInTx(tx, { ...parsed.data, actorId }));
  });
}

export async function mutateMatchRecording(input: unknown) {
  const parsed = z.object({ matchId: uuid, command: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("save"), recording: recordingInput }).strict(),
    z.object({ kind: z.literal("remove"), id: uuid }).strict(),
    z.object({ kind: z.literal("move"), id: uuid, direction: z.enum(["up", "down"]) }).strict(),
  ]) }).strict().safeParse(input);
  if (!parsed.success) return failValidation("录像参数无效，请检查链接和标题。");
  return run(parsed.data.matchId, async actorId => { await db.transaction(tx => mutateMatchRecordingInTx(tx, { ...parsed.data, actorId })); });
}

/** Fresh authorized canonical content and relative order; malformed data is not an empty list. */
export async function getMatchRecordingReadback(matchId: string): Promise<ActionResult<RecordingReadback>> {
  if (!uuid.safeParse(matchId).success) return failValidation("比赛编号无效。");
  try {
    const { match } = await matchAndAdminOrThrow(matchId);
    const [row] = await db.select({ recordings: matches.recordings }).from(matches)
      .where(and(eq(matches.id, match.id), eq(matches.seasonId, match.seasonId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "比赛不存在。");
    const parsed = recordingInput.array().safeParse(row.recordings);
    if (!parsed.success) throw new AppError(ErrorCode.INTERNAL_ERROR, "当前录像数据暂时无法核对。");
    return ok({ matchId, value: parsed.data, version: await recordingReadbackVersion(matchId, parsed.data) });
  } catch (error) { return actionError("getMatchRecordingReadback", error); }
}
