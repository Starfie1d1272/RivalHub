import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { maybeAdvanceFromRegistration } from "@/actions/transitions";
import { validateCronAuth } from "@/lib/cron-auth";
import { openSeasonRegistrationInTx } from "@/lib/seasons/lifecycle";

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const activeSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.status, "registration"));

  let advanced = 0;
  let opened = 0;

  for (const s of activeSeasons) {
    await db.transaction(async (tx) => {
      const openResult = await openSeasonRegistrationInTx(tx, { seasonId: s.id, actorId: "system" });
      if (openResult.opened) opened++;
      await maybeAdvanceFromRegistration(tx, s.id, { invalidation: "route" });
    });
    advanced++;
  }

  const skipped = activeSeasons.length - advanced;

  return NextResponse.json({ ok: true, opened, advanced, skipped });
}
