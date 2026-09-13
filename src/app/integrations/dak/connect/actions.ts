"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { authorizeDakPairing } from "@/lib/demo-integration/pairing";

export async function authorizeDakPairingAction(formData: FormData): Promise<void> {
  const pairingId = String(formData.get("pairingId") ?? "").trim();
  if (!pairingId) redirect("/integrations/dak/connect");
  const authorization = await requireAdmin();
  await authorizeDakPairing(pairingId, authorization);
  redirect(`/integrations/dak/connect?pairingId=${encodeURIComponent(pairingId)}&authorized=1`);
}
