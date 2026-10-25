import {traceOperation} from "@/lib/observability/server";
import {ok} from "@/types/action";
import {AppError,ErrorCode} from "@/lib/errors";
import {actionError} from "@/lib/action-utils";
import {withRouteObservability} from "@/lib/observability/route";
import {predictionRequestInput,pickEmSummaryRequestInput,readPredictionRequest,readPickEmSummaryRequest} from "@/lib/predictions/request-read";
const headers={"Cache-Control":"private, no-store",Vary:"Cookie"};
export async function GET(request:Request,context:{params:Promise<{seasonId:string}>}) {
  return withRouteObservability(request,"/api/predictions/[seasonId]",async()=>{
    try{
      const url=new URL(request.url);
      if(url.search.length>1024)throw new AppError(ErrorCode.VALIDATION_FAILED,"读取参数过长");
      const input:Record<string,string>={...Object.fromEntries(url.searchParams),seasonId:(await context.params).seasonId};
      if(input.view==="tasks"||input.view==="ranking") {
        const parsed=pickEmSummaryRequestInput.safeParse(input);
        if(!parsed.success)throw new AppError(ErrorCode.VALIDATION_FAILED,"读取参数无效");
        const data=await readPickEmSummaryRequest(parsed.data);
        return await traceOperation("predictions.summary.response",{scope:"predictions",operation:"summary",stage:"serialize",attributes:{"rivalhub.workflow":`predictions.${parsed.data.view}`}},async()=>Response.json(ok(data),{headers}));
      }
      const parsed=predictionRequestInput.safeParse(input);
      if(!parsed.success)throw new AppError(ErrorCode.VALIDATION_FAILED,"读取参数无效");
      const data=await readPredictionRequest(parsed.data);
      return await traceOperation("predictions.board.response",{scope:"predictions",operation:"board",stage:"serialize",attributes:{"rivalhub.workflow":`predictions.${parsed.data.view}`}},async()=>Response.json(ok(data),{headers}));
    }catch(error){
      const result=actionError("predictions.http_read",error);
      const code=!result.success?result.error.code:ErrorCode.INTERNAL_ERROR;
      return Response.json(result,{headers,status:code===ErrorCode.NOT_FOUND?404:code===ErrorCode.UNAUTHORIZED?401:code===ErrorCode.FORBIDDEN?403:code===ErrorCode.INTERNAL_ERROR?500:400});
    }
  },{captureServerErrorResponse:false});
}
