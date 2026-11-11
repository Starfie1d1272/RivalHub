import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { logEvent } from "@/lib/observability/server";
import { telemetryBootstrap } from "@/lib/telemetry/server";
import { configuredTelemetryOrigin } from "@/lib/telemetry/origin";

const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin" };
/** Ingest-only renewal, isolated from the business Server Action queue. */
export async function POST(request: Request): Promise<Response> {
  const enabled = process.env.PRODUCT_TELEMETRY_ENABLED === "1";
  const origin = configuredTelemetryOrigin() ?? (enabled ? null : new URL(request.url).origin);
  if (!origin || request.headers.get("origin") !== origin)
    return new Response(null, { status: 403, headers });
  if (!enabled) return Response.json(null, { headers });
  try {
    const authorization = await getCurrentUserAuthorization();
    const config = await telemetryBootstrap(
      authorization
        ? {
            userId: authorization.userId,
            isAdmin: authorization.role === "super_admin" || authorization.seasonIds.length > 0,
            isSuperAdmin: authorization.role === "super_admin",
          }
        : null,
    );
    return Response.json(config, { headers });
  } catch {
    logEvent({
      level: "warn",
      event: "telemetry.bootstrap.unavailable",
      scope: "telemetry",
      operation: "bootstrap",
      errorClass: "dependency",
      retryable: true,
    });
    return new Response(null, { status: 503, headers });
  }
}
