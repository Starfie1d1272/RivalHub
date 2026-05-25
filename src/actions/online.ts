"use server";

import { db } from "@/db/client";
import { userSessions } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { sql } from "drizzle-orm";

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

export async function getOnlineCount(): Promise<{ count: number }> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessions)
    .where(sql`${userSessions.lastActiveAt} > ${fiveMinAgo.toISOString()}`);
  return { count: rows[0]?.count ?? 0 };
}
