"use server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireAuth, requireSeasonAdmin, auditActorId, getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok } from "@/types/action";
import { readUnifiedBetBoard } from "@/lib/bet/board-read";
import { joinBetInTx, stakeBetInTx, operateBetInTx, claimBetReliefInTx } from "@/lib/bet/service";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { startCanonicalMapInTx } from "@/lib/matches/map-start";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { readBetRelief } from "@/lib/bet/relief-data";
const scope=z.object({seasonId:z.guid()});
async function publicSeason(seasonId:string) {
  const season=await db.query.seasons.findFirst({where:eq(seasons.id,seasonId)});
  if(!season || season.competitionTemplate!=="major" || !await getPublicOrAuthorizedDraftSeason(season.slug)) throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  return season;
}
function refresh(slug:string) {revalidatePath(`/${slug}/bet`);revalidatePath(`/admin/${slug}/bet`);}
export async function getUnifiedBetBoard(input:unknown) {
  const p=scope.extend({matchId:z.guid().optional(),view:z.enum(["open","mine","settled","event","leaderboard","records"]).default("open")}).safeParse(input);
  if(!p.success)return failValidation("赛事参数无效");
  try {
    await publicSeason(p.data.seasonId);
    const user=await getUserSession();
    return ok(await db.transaction(tx=>readUnifiedBetBoard(tx,p.data.seasonId,user?.userId??null,p.data),{accessMode:"read only",isolationLevel:"repeatable read"}));
  }catch(e){return actionError("bet.unified_read",e);}
}
const spectator=z.discriminatedUnion("operation",[scope.extend({operation:z.literal("join")}),scope.extend({operation:z.literal("stake"),marketId:z.guid(),optionId:z.guid(),amount:z.union([z.literal("all"),z.string().regex(/^[1-9]\d{0,14}$/)]),requestId:z.guid()})]);
export async function mutateBet(input:unknown) {
  const p=spectator.safeParse(input);if(!p.success)return failValidation("请检查投入积分与所选选项");
  try {const user=await requireAuth();const season=await publicSeason(p.data.seasonId);const receipt=await db.transaction(async tx=>{if(p.data.operation==="join"){await joinBetInTx(tx,p.data.seasonId,user.userId);return {joined:true};}return stakeBetInTx(tx,{...p.data,userId:user.userId});});refresh(season.slug);return ok(receipt);}catch(e){return actionError("bet.mutate",e);}
}
const operation=z.discriminatedUnion("operation",[scope.extend({operation:z.enum(["enable","pause","resume","retry"])}),scope.extend({operation:z.literal("close"),marketId:z.guid()}),scope.extend({operation:z.literal("void"),marketId:z.guid(),reason:z.string().trim().min(1).max(500)})]);
export async function operateBet(input:unknown) {
  const p=operation.safeParse(input);if(!p.success)return failValidation("请检查操作参数与退款原因");
  try {const admin=await requireSeasonAdmin(p.data.seasonId);const season=await publicSeason(p.data.seasonId);await db.transaction(tx=>operateBetInTx(tx,{...p.data,actorId:auditActorId(admin)}));refresh(season.slug);return ok(undefined);}catch(e){return actionError("bet.operate",e);}
}
export async function startOfficialMap(input:unknown) {
  const p=scope.extend({matchId:z.guid(),mapId:z.guid()}).safeParse(input);if(!p.success)return failValidation("请检查当前地图");
  try {const admin=await requireSeasonAdmin(p.data.seasonId);const season=await publicSeason(p.data.seasonId);await db.transaction(async tx=>{await assertSeasonAllowsTournamentMutationInTx(tx,p.data.seasonId);const match=await lockMatchInTx(tx,p.data.matchId);if(match.seasonId!==p.data.seasonId)throw new AppError(ErrorCode.FORBIDDEN,"比赛不属于当前赛事");await startCanonicalMapInTx(tx,match.id,p.data.mapId,auditActorId(admin));});refresh(season.slug);revalidatePath(`/admin/${season.slug}/matches/${p.data.matchId}`);return ok(undefined);}catch(e){return actionError("bet.map_start",e);}
}

/** Wallet contract; reads never mutate financial facts. */
export async function getBetRelief(input: unknown) {
  const parsed = scope.strict().safeParse(input);
  if (!parsed.success) return failValidation("赛事参数无效");
  try {
    await publicSeason(parsed.data.seasonId);
    const user = await getUserSession();
    return ok(await db.transaction(tx => readBetRelief(tx, parsed.data.seasonId, user?.userId ?? null), {accessMode: "read only", isolationLevel: "repeatable read"}));
  } catch (error) { return actionError("bet.relief.read", error); }
}
export async function claimBetRelief(input: unknown) {
  const parsed = scope.extend({day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict().safeParse(input);
  if (!parsed.success) return failValidation("请刷新钱包后领取低保");
  try {
    const user = await requireAuth();
    const season = await publicSeason(parsed.data.seasonId);
    const receipt = await db.transaction(tx => claimBetReliefInTx(tx, {...parsed.data, userId: user.userId}));
    refresh(season.slug);
    return ok(receipt);
  } catch (error) { return actionError("bet.relief.claim", error); }
}
