"use server";

import { getUserSession } from "@/lib/auth/session";
import { heartbeatPresence } from "@/lib/presence/server";

export async function heartbeatOnline(): Promise<{ count: number; windowSeconds: number; intervalMs: number }> {
  const session = await getUserSession();
  return heartbeatPresence(session?.userId ?? null);
}
