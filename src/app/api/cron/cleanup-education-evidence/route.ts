import { NextResponse } from "next/server";
import { validateCronAuth } from "@/lib/cron-auth";
import { withRouteObservability } from "@/lib/observability/route";
import { executeScheduledJob } from "@/lib/scheduler/execution";
import { runEducationEvidenceCleanupJob } from "@/lib/scheduler/runners";

export async function GET(request: Request) {
  return withRouteObservability(request, "/api/cron/cleanup-education-evidence", async () => {
    const authError = validateCronAuth(request);
    if (authError) return authError;

    const result = await executeScheduledJob(request, "cleanup-education-evidence", runEducationEvidenceCleanupJob);
    if (result instanceof Response) return result;
    if (result.skipped) return NextResponse.json({ ok: true, skipped: result.skipReason });
    return NextResponse.json({ ok: true, ...result.result });
  });
}
