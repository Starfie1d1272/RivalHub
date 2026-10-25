import "server-only";
import { traceOperation } from "@/lib/observability/server";
import { getBetPublicStats } from "./public-stats-cache";
import { completeUnifiedBetSnapshot, type readUnifiedBetSnapshot, type UnifiedBoardScope } from "./board-read";
import type { BetPublicStats } from "./public-stats-read";

type Snapshot = Awaited<ReturnType<typeof readUnifiedBetSnapshot>>;

/** Called only after fresh season authorization and session resolution.
 * Public aggregates and the private repeatable-read transaction are independent.
 * A changed free-prediction subject discards the whole private snapshot and
 * reads one fresh snapshot; it never mixes private facts across connections.
 */
export async function readBetBoardStages<T extends {board:Snapshot}>(
  season:{id:string;slug:string;status:string}, scope:UnifiedBoardScope,
  read:(stats:BetPublicStats | "deferred" | undefined)=>Promise<T>,
):Promise<T> {
  if (season.status === "draft" || ["records","leaderboard"].includes(scope.view ?? "open")) return read(undefined);
  const [stats,data] = await Promise.all([getBetPublicStats(season,scope),read("deferred")]);
  const board = completeUnifiedBetSnapshot(data.board,stats);
  if (board) return {...data,board};
  return traceOperation("bet.board.aggregate_fallback",{scope:"bet",operation:"board",stage:"read"},()=>read(undefined));
}
