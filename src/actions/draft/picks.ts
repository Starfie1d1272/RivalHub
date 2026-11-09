"use server";

import { ok, type ActionResult } from "@/types/action";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { failValidation, actionError } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import {
  pickPlayerSchema,
  skipDraftTurnSchema,
  type PickPlayerInput,
  type SkipDraftTurnInput,
} from "@/lib/validators/draft";
import { executeCaptainDraftPick, executeDraftSkip } from "@/lib/draft/operations";

export async function pickPlayer(
  input: PickPlayerInput,
): Promise<ActionResult<{ pickId: string; idempotent: boolean; completed: boolean }>> {
  const parsed = pickPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("选择选手参数无效");
  }

  try {
    const user = await requireAuth();
    const result = await executeCaptainDraftPick({
      ...parsed.data,
      captainUserId: user.userId,
    });

    revalidateSeasonPaths(result.slug, ["draft", "draftCaptain", "teams", "adminDraft"]);
    return ok({
      pickId: result.pickId,
      idempotent: result.idempotent,
      completed: result.completed,
    });
  } catch (e) {
    return actionError("pickPlayer", e);
  }
}

/** Operator recovery for a timed-out turn with no automatic pick candidate. */
export async function skipDraftTurn(
  input: SkipDraftTurnInput,
): Promise<ActionResult<{ skipped: boolean; completed: boolean }>> {
  const parsed = skipDraftTurnSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("跳过轮次参数无效");
  }
  try {
    const admin = await requireSeasonAdmin(parsed.data.seasonId);
    const result = await executeDraftSkip({
      ...parsed.data,
      actorId: auditActorId(admin),
      actorEmail: admin.email,
    });

    revalidateSeasonPaths(result.slug, ["draft", "draftCaptain", "teams", "adminDraft"]);
    return ok({ skipped: true, completed: result.completed });
  } catch (e) {
    return actionError("skipDraftTurn", e);
  }
}
