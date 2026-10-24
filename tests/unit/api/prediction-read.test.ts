import {beforeEach,expect,it,vi} from "vitest";
const reads=vi.hoisted(()=>({bet:vi.fn(),prediction:vi.fn(),summary:vi.fn()}));
vi.mock("@/lib/bet/request-read",async original=>({...await original<typeof import("@/lib/bet/request-read")>(),readBetBoardRequest:reads.bet}));
vi.mock("@/lib/predictions/request-read",async original=>({...await original<typeof import("@/lib/predictions/request-read")>(),readPredictionRequest:reads.prediction,readPickEmSummaryRequest:reads.summary}));
vi.mock("@/lib/observability/route",()=>({withRouteObservability:(_request:Request,_route:string,handler:()=>unknown)=>handler()}));
import {GET as bet} from "@/app/api/bet/[seasonId]/route";
import {GET as prediction} from "@/app/api/predictions/[seasonId]/route";
import {AppError,ErrorCode} from "@/lib/errors";
const seasonId="00000000-0000-4000-8000-000000000001";
const context={params:Promise.resolve({seasonId})};
beforeEach(()=>{vi.clearAllMocks();reads.bet.mockResolvedValue({bet:{balance:"0"},free:{matches:[]}});reads.prediction.mockResolvedValue({joined:false});reads.summary.mockResolvedValue({achievement:null,pickLeaderboard:[],mine:null});});
it("uses bounded explicit view inputs, private uncached responses and no client viewer identity",async()=>{
  for(const [get,path] of [[bet,"bet"],[prediction,"predictions"]] as const){
    const response=await get(new Request(`http://localhost/api/${path}/${seasonId}`),context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect((await get(new Request(`http://localhost/api/${path}/${seasonId}?userId=${seasonId}`),context)).status).toBe(400);
    expect((await get(new Request(`http://localhost/api/${path}/${seasonId}?view=points`),context)).status).toBe(400);
  }
  expect(reads.bet).toHaveBeenCalledTimes(1);expect(reads.prediction).toHaveBeenCalledTimes(1);
});
it("keeps draft/permission refusal private and delegates task/rank to the narrow summary owner",async()=>{
  reads.bet.mockRejectedValueOnce(new AppError(ErrorCode.NOT_FOUND,"赛事不存在"));
  expect((await bet(new Request(`http://localhost/api/bet/${seasonId}`),context)).status).toBe(404);
  expect((await prediction(new Request(`http://localhost/api/predictions/${seasonId}?view=ranking`),context)).status).toBe(200);
  expect(reads.summary).toHaveBeenCalledWith({seasonId,view:"ranking"});
  expect(reads.prediction).not.toHaveBeenCalled();
});
