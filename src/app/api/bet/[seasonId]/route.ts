import {ok} from "@/types/action";
import {AppError,ErrorCode} from "@/lib/errors";
import {actionError} from "@/lib/action-utils";
import {withRouteObservability} from "@/lib/observability/route";
import {betBoardRequestInput,readBetBoardRequest} from "@/lib/bet/request-read";
const headers={"Cache-Control":"private, no-store",Vary:"Cookie"};
export async function GET(request:Request,context:{params:Promise<{seasonId:string}>}) {
  return withRouteObservability(request,"/api/bet/[seasonId]",async()=>{
    try{
      const url=new URL(request.url);
      if(url.search.length>1024)throw new AppError(ErrorCode.VALIDATION_FAILED,"读取参数过长");
      const input={...Object.fromEntries(url.searchParams),seasonId:(await context.params).seasonId};
      const parsed=betBoardRequestInput.safeParse(input);
      if(!parsed.success)throw new AppError(ErrorCode.VALIDATION_FAILED,"读取参数无效");
      const data=await readBetBoardRequest(parsed.data);
      return await Response.json(ok(data),{headers});
    }catch(error){
      const result=actionError("bet.http_read",error);
      const code=!result.success?result.error.code:ErrorCode.INTERNAL_ERROR;
      return Response.json(result,{headers,status:code===ErrorCode.NOT_FOUND?404:code===ErrorCode.UNAUTHORIZED?401:code===ErrorCode.FORBIDDEN?403:code===ErrorCode.INTERNAL_ERROR?500:400});
    }
  },{captureServerErrorResponse:false});
}
