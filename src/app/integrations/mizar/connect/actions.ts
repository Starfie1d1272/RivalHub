"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { authorizeMizarPairing } from "@/lib/mizar/installation";

export async function authorizeMizarPairingAction(formData: FormData): Promise<void> {
  const parsed = z.object({ pairingId: z.uuid(), competitionId: z.uuid() }).safeParse({
    pairingId: formData.get("pairingId"),
    competitionId: formData.get("competitionId"),
  });
  if (!parsed.success) redirect("/integrations/mizar/connect");
  const authorization = await requireAdmin();
  await authorizeMizarPairing(parsed.data.pairingId, parsed.data.competitionId, authorization);
  redirect(`/integrations/mizar/connect?pairingId=${encodeURIComponent(parsed.data.pairingId)}&authorized=1`);
}
