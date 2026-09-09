"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { actionError, failValidation } from "@/lib/action-utils";
import { requireAuth } from "@/lib/auth/session";
import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";
import { ok, type ActionResult } from "@/types/action";

export async function recoverRegistrationOpening(input: unknown): Promise<ActionResult<{ opened: boolean }>> {
  const parsed = z.object({ seasonId: z.guid() }).safeParse(input);
  if (!parsed.success) return failValidation("赛事标识无效。");

  try {
    await requireAuth();
    const result = await db.transaction((tx) => ensureRegistrationOpenForParticipantInTx(tx, parsed.data.seasonId));
    revalidatePath(`/${result.season.slug}/register`);
    return ok({ opened: result.opened });
  } catch (error) {
    return actionError("recoverRegistrationOpening", error);
  }
}
