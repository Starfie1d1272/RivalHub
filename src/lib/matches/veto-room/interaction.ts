import "server-only";
import { z } from "zod";
import { AppError, ErrorCode } from "@/lib/errors";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { logEvent } from "@/lib/observability/server";
import { assertVetoRoomReadable } from "./access";
import { getVetoRoomView } from "./read-model";
import { deliverVetoInvalidation } from "./invalidation";
import { reconcileVetoRoomReceipt, requestVetoStartReceipt, submitVetoCommandReceipt } from "./service";

const base = z.object({ matchId: z.uuid() });
const revision = z.object({ expectedRevision: z.number().int().nonnegative(), expectedTurnKey: z.string().max(100).nullable() });
export const vetoStartInput = base.extend({ entryId: z.uuid() }).merge(revision);
export const vetoCommandInput = base.extend({ ...revision.shape, expectedTurnKey: z.string().min(1).max(100), clientRequestId: z.uuid(),
  command: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("role_select"), entryId: z.uuid() }),
    z.object({ kind: z.literal("step"), actionType: z.enum(["ban", "pick", "side_pick"]), mapName: z.string().min(1).max(100).optional(), side: z.enum(["t", "ct"]).optional() }),
  ]),
});
export const vetoInteractionInput = z.discriminatedUnion("operation", [
  vetoStartInput.extend({ operation: z.literal("start") }),
  vetoCommandInput.extend({ operation: z.literal("command") }),
  base.extend({ operation: z.literal("reconcile") }),
]);

/** One authenticated workflow for both transports; clocks, locks and idempotency stay in the service. */
export async function runVetoInteraction(input: z.infer<typeof vetoInteractionInput>, mode: "action" | "route") {
  let outcome;
  let authorization: Awaited<ReturnType<typeof getCurrentUserAuthorization>> | undefined;
  let readableSeasonId: string | undefined;
  if (input.operation === "reconcile") {
    const access = await assertVetoRoomReadable(input.matchId);
    authorization = access.authorization;
    readableSeasonId = access.seasonId;
    outcome = await reconcileVetoRoomReceipt(input.matchId, readableSeasonId);
  } else {
    authorization = await getCurrentUserAuthorization();
    if (!authorization) throw new AppError(ErrorCode.UNAUTHORIZED, "请先登录。");
    const actor = authorization;
    outcome = await (input.operation === "start"
      ? requestVetoStartReceipt({ ...input, actorId: actor.userId })
      : submitVetoCommandReceipt({ ...input, actorId: actor.userId }));
  }
  return { ...await finishVetoInteraction(input.matchId, outcome.outcome, outcome.changed, mode, authorization, readableSeasonId), receipt: outcome };
}

/** Domain commit, cache delivery and response projection have independent outcomes. */
export async function finishVetoInteraction<T>(matchId: string, outcome: T, _changed: boolean, mode: "action" | "route" = "action", authorization?: Awaited<ReturnType<typeof getCurrentUserAuthorization>>, expectedSeasonId?: string) {
  let invalidation: "complete" | "pending" = "pending";
  try {
    invalidation = await deliverVetoInvalidation(matchId, mode);
  } catch {
    // The durable generation stays pending. Even a no-op reconcile retries it.
    logEvent({ level: "warn", event: "match.veto.invalidation_pending", scope: "match", operation: "veto.invalidate", retryable: true });
  }
  try {
    const room = await (authorization === undefined ? getVetoRoomView(matchId) : getVetoRoomView(matchId, authorization, expectedSeasonId));
    return { outcome, room, refreshFailed: invalidation === "pending", postCommit: { invalidation, projection: "complete" as const } };
  } catch {
    logEvent({ level: "warn", event: "match.veto.projection_pending", scope: "match", operation: "veto.project", retryable: true });
    return { outcome, room: null, refreshFailed: true, postCommit: { invalidation, projection: "pending" as const } };
  }
}
