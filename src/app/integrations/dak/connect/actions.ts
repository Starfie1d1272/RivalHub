"use server";

import { actionError, failValidation } from "@/lib/action-utils";
import { ok } from "@/types/action";

import { requireAdmin } from "@/lib/auth/session";
import { authorizeDakPairing } from "@/lib/demo-integration/pairing";

export async function authorizeDakPairingAction(formData: FormData) {
  try {
    const pairingId = String(formData.get("pairingId") ?? "").trim();
    if (!pairingId) return failValidation("连接请求无效");
    const authorization = await requireAdmin();
    await authorizeDakPairing(pairingId, authorization);
    return ok({ redirectTo: `/integrations/dak/connect?pairingId=${encodeURIComponent(pairingId)}&authorized=1` });
  } catch (error) { return actionError("integrations.dak.authorize", error); }
}
