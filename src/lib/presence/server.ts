import "server-only";
import { db } from "@/db/client";
import { userSessions } from "@/db/schema";
import { sql } from "drizzle-orm";
import { PresenceState } from "./state";

const runtime = globalThis as typeof globalThis & { rivalhubPresence?: PresenceState };

export async function heartbeatPresence(userId: string | null): Promise<{ count: number; windowSeconds: number; intervalMs: number }> {
  const now = Date.now();
  const persist = async () => {
    const written = await db.insert(userSessions).values({ userId: userId!, lastActiveAt: new Date(now) })
      .onConflictDoUpdate({ target: userSessions.userId, set: { lastActiveAt: new Date(now) },
        setWhere: sql`${userSessions.lastActiveAt} <= ${new Date(now - 300_000).toISOString()}` })
      .returning({ userId: userSessions.userId });
    return written.length > 0;
  };
  if (process.env.RIVALHUB_PRESENCE_MODE === "single-process") {
    const state = runtime.rivalhubPresence ??= new PresenceState();
    if (userId) await state.touch(userId, now, persist);
    return { count: state.count(now), windowSeconds: 120, intervalMs: 60_000 };
  }
  if (userId) await persist();
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(userSessions)
    .where(sql`${userSessions.lastActiveAt} > ${new Date(now - 300_000).toISOString()}`);
  return { count: rows[0]?.count ?? 0, windowSeconds: 300, intervalMs: 300_000 };
}
