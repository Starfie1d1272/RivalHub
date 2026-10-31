import "server-only";
import {eq} from "drizzle-orm";
import {db} from "@/db/client";
import {seasons} from "@/db/schema";
import {requireSeasonAdmin} from "@/lib/auth/session";
import {AppError,ErrorCode,isExpectedAuthFailure} from "@/lib/errors";

/** Fresh membership/authorization stays outside every shared aggregate cache. */
export async function authorizePublicMajorRead(seasonId:string) {
  const season=await db.query.seasons.findFirst({where:eq(seasons.id,seasonId),columns:{id:true,slug:true,status:true,competitionTemplate:true}});
  if(!season||season.competitionTemplate!=="major")throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");
  if(season.status==="draft") {
    try{await requireSeasonAdmin(seasonId);}
    catch(error){if(!isExpectedAuthFailure(error))throw error;throw new AppError(ErrorCode.NOT_FOUND,"赛事不存在");}
  }
  return season;
}
