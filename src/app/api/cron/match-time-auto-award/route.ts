import { NextResponse } from "next/server";
import { runMatchTimeAutoAwardCron } from "@/actions/matches";
import { validateCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const result = await runMatchTimeAutoAwardCron();

  return NextResponse.json({ ok: true, ...result });
}
