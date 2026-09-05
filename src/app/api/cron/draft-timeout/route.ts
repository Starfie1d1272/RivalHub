import { NextResponse } from "next/server";
import { runDraftTimeoutCron } from "@/actions/draft";
import { validateCronAuth } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/route";

export async function GET(request: Request) {
  return withRouteObservability(request, "/api/cron/draft-timeout", async () => {
    const authError = validateCronAuth(request);
    if (authError) return authError;

    const result = await runDraftTimeoutCron();
    return NextResponse.json(
      { ok: true, processed: result.picked + result.skipped, picked: result.picked, skipped: result.skipped },
    );
  });
}
