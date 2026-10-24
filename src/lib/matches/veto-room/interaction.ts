import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { logEvent, traceOperation } from "@/lib/observability/server";
import { assertVetoRoomReadable } from "./access";
import { getVetoRoomView } from "./read-model";
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
  if (input.operation === "reconcile") {
    await traceOperation("match.veto.authorize", { scope: "match", operation: "reconcile", stage: "authorize" }, () => assertVetoRoomReadable(input.matchId));
    outcome = await traceOperation("match.veto.transaction", { scope: "match", operation: "reconcile", stage: "transaction" }, () => reconcileVetoRoomReceipt(input.matchId));
  } else {
    authorization = await traceOperation("match.veto.authorize", { scope: "match", operation: input.operation, stage: "authorize" }, () => getCurrentUserAuthorization());
    if (!authorization) throw new AppError(ErrorCode.UNAUTHORIZED, "请先登录。");
    const actor = authorization;
    outcome = await traceOperation("match.veto.transaction", { scope: "match", operation: input.operation, stage: "transaction" }, () => input.operation === "start"
      ? requestVetoStartReceipt({ ...input, actorId: actor.userId })
      : submitVetoCommandReceipt({ ...input, actorId: actor.userId }));
  }
  try {
    const result = await finishVetoInteraction(input.matchId, outcome.outcome, outcome.changed, mode, authorization);
    return { ...result, receipt: outcome, refreshFailed: false };
  } catch {
    logEvent({ level: "warn", event: "match.veto.refresh_failed", scope: "match", operation: "veto.refresh", retryable: false });
    return { outcome: outcome.outcome, room: null, receipt: outcome, refreshFailed: true };
  }
}

/** Invalidate committed facts before the fallible response projection. */
export async function finishVetoInteraction<T>(matchId: string, outcome: T, changed: boolean, mode: "action" | "route" = "action", authorization?: Awaited<ReturnType<typeof getCurrentUserAuthorization>>) {
  if (changed) await traceOperation("match.veto.invalidate", { scope: "match", operation: "invalidate", stage: "invalidate" }, async () => {
    const [context] = await db.select({ slug: seasons.slug }).from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId))
      .where(eq(matches.id, matchId)).limit(1);
    if (!context) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
    revalidateMatchPaths(context.slug, matchId, { mode });
  });
  return { outcome, room: await traceOperation("match.veto.project", { scope: "match", operation: "project", stage: "project" },
    () => authorization === undefined ? getVetoRoomView(matchId) : getVetoRoomView(matchId, authorization)) };
}
