import type {ActionResult} from "@/types/action";
import type {PickEmBoardData,PickEmSummary} from "./data";
async function read<T>(input:{seasonId:string;view:string},signal?:AbortSignal):Promise<ActionResult<T>> {
  const response=await fetch(`/api/predictions/${encodeURIComponent(input.seasonId)}?${new URLSearchParams({view:input.view})}`,{cache:"no-store",credentials:"same-origin",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  return response.json();
}
export function fetchPredictionBoard(input:{seasonId:string;view:"sim"|"record"},signal?:AbortSignal) {return read<PickEmBoardData>(input,signal);}
export function fetchPickEmSummary(input:{seasonId:string;view:"tasks"|"ranking"},signal?:AbortSignal) {return read<PickEmSummary>(input,signal);}
