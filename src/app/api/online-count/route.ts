import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { userSessions } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessions)
    .where(sql`${userSessions.lastActiveAt} > ${fiveMinAgo.toISOString()}`);
  return NextResponse.json({ count: rows[0]?.count ?? 0 });
}
