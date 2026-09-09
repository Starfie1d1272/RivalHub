import { NextResponse } from "next/server";
import { loginWithPassword } from "@/actions/auth";

/**
 * Test-only browser bootstrap. It still delegates to the canonical password
 * login, so Supabase Auth and the application session are both exercised.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production" || (process.env.CI !== "true" && process.env.RIVALHUB_E2E_AUTH_BOOTSTRAP !== "1")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!isCredentials(input)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const result = await loginWithPassword(input.email, input.password);
  if (!result.success) return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  return NextResponse.json({ ok: true });
}

function isCredentials(value: unknown): value is { email: string; password: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.email === "string" && typeof candidate.password === "string";
}
