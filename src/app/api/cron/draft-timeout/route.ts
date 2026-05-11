import { NextResponse } from "next/server";
import { runDraftTimeoutCron } from "@/actions/draft";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDraftTimeoutCron(cronSecret);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[draft-timeout-cron]", e);
    return NextResponse.json(
      { ok: false, error: "Draft timeout cron failed" },
      { status: 500 },
    );
  }
}
