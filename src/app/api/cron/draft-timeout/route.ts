import { NextResponse } from "next/server";

// TODO: implement auto-pick logic when captain timer expires
// Triggered by Vercel Cron every minute during active draft
// Security: validate CRON_SECRET header
export async function GET() {
  throw new Error("not implemented");
  return NextResponse.json({ ok: true });
}
