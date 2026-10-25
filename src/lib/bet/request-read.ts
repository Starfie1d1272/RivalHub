import "server-only";
import {traceOperation} from "@/lib/observability/server";
import {z} from "zod";
import {sql} from "drizzle-orm";
import {db} from "@/db/client";
import {getUserSession} from "@/lib/auth/session";
import {authorizePublicMajorRead} from "./read-access";
import {readBetBoardStages} from "./board-stages";
import {readUnifiedBetSnapshot,projectUnifiedBetBoard} from "./board-read";
export const betBoardRequestInput=z.object({seasonId:z.guid(),matchId:z.guid().optional(),view:z.enum(["open","mine","settled","event","leaderboard","records"]).default("open")}).strict();
export async function readBetBoardRequest(input:z.infer<typeof betBoardRequestInput>) {
  const season=await traceOperation("bet.board.authorize",{scope:"bet",operation:"board",stage:"authorize"},()=>authorizePublicMajorRead(input.seasonId));
  const user=await traceOperation("bet.board.session",{scope:"bet",operation:"board",stage:"authorize"},()=>getUserSession());
  const {board:snapshot}=await readBetBoardStages(season,input,publicStats=>traceOperation("bet.board.transaction",{scope:"bet",operation:"board",stage:"transaction",attributes:{"rivalhub.workflow":`bet.${input.view}`}},()=>db.transaction(async tx=>{
    await tx.execute(sql`set local statement_timeout = '5000ms'`);
    return {board:await readUnifiedBetSnapshot(tx,input.seasonId,user?.userId??null,input,publicStats)};
  },{accessMode:"read only",isolationLevel:"repeatable read"})));
  return traceOperation("bet.board.project",{scope:"bet",operation:"board",stage:"project",attributes:{"rivalhub.workflow":`bet.${input.view}`}},async()=>projectUnifiedBetBoard(snapshot));
}
