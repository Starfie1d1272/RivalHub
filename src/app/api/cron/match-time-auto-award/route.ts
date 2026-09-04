import { NextResponse } from "next/server";
import { runMatchTimeAutoAwardCron } from "@/actions/matches";
import { validateCronAuth } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/route";

export async function GET(request: Request) {
  return withRouteObservability(request, "/api/cron/match-time-auto-award", async () => {
    const authError = validateCronAuth(request);
    if (authError) return authError;

    const result = await runMatchTimeAutoAwardCron();

    return NextResponse.json({ ok: true, ...result });
  });
}
