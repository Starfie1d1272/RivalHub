"use server";

import { actionError, failValidation } from "@/lib/action-utils";
import { ok } from "@/types/action";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { authorizeMizarPairing } from "@/lib/mizar/installation";

export async function authorizeMizarPairingAction(formData: FormData) {
  try {
    const parsed = z.object({ pairingId: z.uuid(), competitionId: z.uuid() }).safeParse({
      pairingId: formData.get("pairingId"),
      competitionId: formData.get("competitionId"),
    });
    if (!parsed.success) return failValidation("连接请求无效");
    const authorization = await requireAdmin();
    await authorizeMizarPairing(parsed.data.pairingId, parsed.data.competitionId, authorization);
    return ok({ redirectTo: `/integrations/mizar/connect?pairingId=${encodeURIComponent(parsed.data.pairingId)}&authorized=1` });
  } catch (error) { return actionError("integrations.mizar.authorize", error); }
}
