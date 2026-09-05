import "server-only";

import { NextResponse } from "next/server";
import { logEvent } from "@/lib/observability/server";

export function validateCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    logEvent({
      level: "info",
      event: "cron.auth.rejected",
      scope: "security",
      operation: "cron.auth",
      errorClass: "expected",
      safeContext: { reason: "missing_or_invalid_credentials" },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
