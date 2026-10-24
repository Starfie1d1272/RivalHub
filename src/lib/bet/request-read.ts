import "server-only";
import {traceOperation} from "@/lib/observability/server";
import {z} from "zod";
import {sql} from "drizzle-orm";
import {db} from "@/db/client";
import {getUserSession} from "@/lib/auth/session";
import {authorizePublicMajorRead} from "./read-access";
import {getBetPublicStats} from "./public-stats-cache";
import {readUnifiedBetSnapshot,projectUnifiedBetBoard} from "./board-read";
export const betBoardRequestInput=z.object({seasonId:z.guid(),matchId:z.guid().optional(),view:z.enum(["open","mine","settled","event","leaderboard","records"]).default("open")}).strict();
export async function readBetBoardRequest(input:z.infer<typeof betBoardRequestInput>) {
  const season=await authorizePublicMajorRead(input.seasonId);
  const user=await getUserSession();
  const publicStats=await getBetPublicStats(season,input);
  const snapshot=await traceOperation("bet.board.transaction",{scope:"bet",operation:"board",stage:"transaction"},()=>db.transaction(async tx=>{
    await tx.execute(sql`set local statement_timeout = '5000ms'`);
    return readUnifiedBetSnapshot(tx,input.seasonId,user?.userId??null,input,publicStats);
  },{accessMode:"read only",isolationLevel:"repeatable read"}));
  return traceOperation("bet.board.project",{scope:"bet",operation:"board",stage:"project"},async()=>projectUnifiedBetBoard(snapshot));
}
