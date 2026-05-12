import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { maybeAdvanceFromRegistration } from "@/actions/transitions";

// Vercel Cron 每分钟触发
// 安全：Authorization: Bearer ${CRON_SECRET}
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, "registration"));

  let advanced = 0;

  for (const s of activeSeasons) {
    await db.transaction(async (tx) => {
      await maybeAdvanceFromRegistration(tx, s.id);
    });
    advanced++;
  }

  const skipped = activeSeasons.length - advanced;

  return NextResponse.json({ ok: true, advanced, skipped });
}
