import "server-only";
import {z} from "zod";
import {sql} from "drizzle-orm";
import {db} from "@/db/client";
import {getUserSession} from "@/lib/auth/session";
import {authorizePublicMajorRead} from "./read-access";
import {readBetBoardStages} from "./board-stages";
import {readUnifiedBetSnapshot,projectUnifiedBetBoard} from "./board-read";
export const betBoardRequestInput=z.object({seasonId:z.guid(),matchId:z.guid().optional(),view:z.enum(["open","mine","settled","event","leaderboard","records"]).default("open")}).strict();
export async function readBetBoardRequest(input:z.infer<typeof betBoardRequestInput>) {
  const season=await authorizePublicMajorRead(input.seasonId);
  const user=await getUserSession();
  const {board:snapshot}=await readBetBoardStages(season,input,async publicStats=>db.transaction(async tx=>{
    await tx.execute(sql`set local statement_timeout = '5000ms'`);
    return {board:await readUnifiedBetSnapshot(tx,input.seasonId,user?.userId??null,input,publicStats)};
  },{accessMode:"read only",isolationLevel:"repeatable read"}));
  return projectUnifiedBetBoard(snapshot);
}
