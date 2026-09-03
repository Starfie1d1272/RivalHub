import { NextResponse } from "next/server";
import { purgeExpiredEducationEvidence } from "@/lib/education/retention";
import { validateCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const cleared = await purgeExpiredEducationEvidence();
  return NextResponse.json({ ok: true, cleared });
}
