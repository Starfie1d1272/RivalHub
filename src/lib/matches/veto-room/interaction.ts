import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { requireAuth } from "@/lib/auth/session";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { assertVetoRoomReadable } from "./access";
import { getVetoRoomView } from "./read-model";
import { reconcileVetoRoom, requestVetoStart, submitVetoCommand } from "./service";

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
  if (input.operation === "reconcile") {
    await assertVetoRoomReadable(input.matchId);
    outcome = await reconcileVetoRoom(input.matchId);
  } else {
    const actor = await requireAuth();
    outcome = input.operation === "start"
      ? await requestVetoStart({ ...input, actorId: actor.userId })
      : await submitVetoCommand({ ...input, actorId: actor.userId });
  }
  return finishVetoInteraction(input.matchId, outcome, outcome === "applied", mode);
}

/** Invalidate committed facts before the fallible response projection. */
export async function finishVetoInteraction<T>(matchId: string, outcome: T, changed: boolean, mode: "action" | "route" = "action") {
  if (changed) {
    const [context] = await db.select({ slug: seasons.slug }).from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId))
      .where(eq(matches.id, matchId)).limit(1);
    if (!context) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
    revalidateMatchPaths(context.slug, matchId, { mode });
  }
  return { outcome, room: await getVetoRoomView(matchId) };
}
