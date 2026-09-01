import { NextRequest, NextResponse } from "next/server";
import { safeLocalRedirect } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const applicationOrigin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const url = new URL(request.url);
  const flow = callbackFlow(url);
  const tokenHash = url.searchParams.get("token_hash");
  if (!flow || !tokenHash) {
    return confirmationFailure(applicationOrigin);
  }
  const confirmationUrl = new URL("/auth/confirmation", applicationOrigin);
  confirmationUrl.searchParams.set("flow", flow);
  confirmationUrl.searchParams.set("token_hash", tokenHash);
  const next = safeLocalRedirect(url.searchParams.get("next"), "");
  if (next) confirmationUrl.searchParams.set("next", next);
  return NextResponse.redirect(confirmationUrl);
}

function confirmationFailure(applicationOrigin: string): NextResponse {
  return NextResponse.redirect(new URL("/auth/confirmation", applicationOrigin));
}

function callbackFlow(url: URL): "signup" | "reverify" | null {
  const queryFlow = url.searchParams.get("flow");
  if (queryFlow === "signup" || queryFlow === "reverify") return queryFlow;
  const pathFlow = url.pathname.split("/").at(-1);
  return pathFlow === "signup" || pathFlow === "reverify" ? pathFlow : null;
}
