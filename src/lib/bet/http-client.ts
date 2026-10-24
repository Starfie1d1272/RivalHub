import type {ActionResult} from "@/types/action";
import type {projectUnifiedBetBoard} from "./board-read";
/** Private reads have their own cancellable HTTP request, independent of action writes. */
export async function fetchBetBoard(input:{seasonId:string;view?:string;matchId?:string},signal?:AbortSignal):Promise<ActionResult<ReturnType<typeof projectUnifiedBetBoard>>> {
  const query=new URLSearchParams({view:input.view??"open",...(input.matchId?{matchId:input.matchId}:{})});
  const response=await fetch(`/api/bet/${encodeURIComponent(input.seasonId)}?${query}`,{cache:"no-store",credentials:"same-origin",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  return response.json();
}
