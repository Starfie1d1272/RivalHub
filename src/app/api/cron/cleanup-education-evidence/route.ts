import { NextResponse } from "next/server";
import { purgeExpiredEducationEvidence } from "@/lib/education/retention";
import { validateCronAuth } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/route";

export async function GET(request: Request) {
  return withRouteObservability(request, "/api/cron/cleanup-education-evidence", async () => {
    const authError = validateCronAuth(request);
    if (authError) return authError;

    const cleared = await purgeExpiredEducationEvidence();
    return NextResponse.json({ ok: true, cleared });
  });
}
