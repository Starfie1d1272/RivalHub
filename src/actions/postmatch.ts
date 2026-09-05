"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { addMatchCommentatorInTx, removeMatchCommentatorInTx, revokePostMatchSubmissionInTx, setMatchVideoUrlInTx, submitPostMatchReportInTx } from "@/lib/postmatch/service";
import { fail, ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { isHttpUrl } from "@/lib/external-url";
import { revalidateMatchPaths } from "@/lib/revalidation";
const uuid = z.string().uuid();
const url = z.string().trim().max(2000).refine(isHttpUrl, "录像链接必须是 http 或 https URL");
function invalid(message: string): ActionResult<never> { return fail({ code: ErrorCode.VALIDATION_FAILED, message }); }
async function matchAndAdminOrThrow(matchId: string) { const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId), columns: { id: true, seasonId: true } }); if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。"); const season = await db.query.seasons.findFirst({ where: eq(seasons.id, match.seasonId), columns: { slug: true } }); if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。"); return { match, season, admin: await requireSeasonAdmin(match.seasonId) }; }
async function run(matchId: string, work: (actorId: string) => Promise<void>): Promise<ActionResult<void>> { try { const { match, season, admin } = await matchAndAdminOrThrow(matchId); await work(auditActorId(admin)); revalidateMatchPaths(season.slug, match.id); return ok(undefined); } catch (error) { return actionError("postmatch", error); } }
export async function addMatchCommentator(input: unknown) { const p = z.object({ matchId: uuid, userId: uuid }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => addMatchCommentatorInTx(tx, { ...p.data, actorId })); }) : invalid("解说参数无效。"); }
export async function removeMatchCommentator(input: unknown) { const p = z.object({ matchId: uuid, userId: uuid }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => removeMatchCommentatorInTx(tx, { ...p.data, actorId })); }) : invalid("解说参数无效。"); }
export async function updateMatchVideoUrl(input: unknown) { const p = z.object({ matchId: uuid, videoUrl: z.union([url, z.literal(""), z.null()]).optional() }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => setMatchVideoUrlInTx(tx, { matchId: p.data.matchId, videoUrl: p.data.videoUrl || null, actorId })); }) : invalid("录像链接无效。"); }
export async function submitPostMatchReport(input: unknown) { const p = z.object({ matchId: uuid }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId: p.data.matchId, actorId })); }) : invalid("赛后提交参数无效。"); }
export async function revokePostMatchSubmission(input: unknown) { const p = z.object({ matchId: uuid }).safeParse(input); return p.success ? run(p.data.matchId, async (actorId) => { await db.transaction((tx) => revokePostMatchSubmissionInTx(tx, { matchId: p.data.matchId, actorId })); }) : invalid("撤销提交参数无效。"); }
