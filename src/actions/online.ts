"use server";

import { db } from "@/db/client";
import { userSessions } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";

export async function touchSession(): Promise<void> {
  const session = await getUserSession();
  if (!session?.userId) return;

  await db
    .insert(userSessions)
    .values({ userId: session.userId, lastActiveAt: new Date() })
    .onConflictDoUpdate({
      target: userSessions.userId,
      set: { lastActiveAt: new Date() },
    });
}
