import "server-only";
import {z} from "zod";
import {sql} from "drizzle-orm";
import {db} from "@/db/client";
import {getUserSession} from "@/lib/auth/session";
import {authorizePublicMajorRead} from "@/lib/bet/read-access";
import {readPredictionSnapshot,projectPredictionBoard,publicPickEmBoard,projectPickEmSummary} from "./data";
export const predictionRequestInput=z.object({seasonId:z.guid(),view:z.enum(["sim","record"]).default("sim")}).strict();
export const pickEmSummaryRequestInput=z.object({seasonId:z.guid(),view:z.enum(["tasks","ranking"])}).strict();
async function snapshot(input:{seasonId:string;view:"sim"|"record"},detail:boolean) {
  await authorizePublicMajorRead(input.seasonId);
  const user=await getUserSession();
  return db.transaction(async tx=>{
    await tx.execute(sql`set local statement_timeout = '5000ms'`);
    return readPredictionSnapshot(tx,input.seasonId,user?.userId??null,input.view,detail);
  },{accessMode:"read only",isolationLevel:"repeatable read"});
}
export async function readPredictionRequest(input:z.infer<typeof predictionRequestInput>) {
  const read=await snapshot(input,true);
  return publicPickEmBoard(projectPredictionBoard(read));
}
export async function readPickEmSummaryRequest(input:z.infer<typeof pickEmSummaryRequestInput>) {
  const read=await snapshot({...input,view:input.view==="ranking"?"record":"sim"},false);
  return projectPickEmSummary(read);
}
