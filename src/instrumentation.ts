import type { Instrumentation } from "next";
import { extractErrorDigest } from "@/lib/observability/error-digest";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" &&
      process.env.VERCEL !== "1" && process.env.NEXT_PHASE !== "phase-production-build" &&
      process.env.RIVALHUB_RUNTIME_HEALTH_ENABLED !== "0") {
    const { initializeDbTraffic } = await import("@/lib/observability/db-traffic");
    await initializeDbTraffic();
    const { startRuntimeHealthSampling } = await import("@/lib/observability/runtime-health");
    startRuntimeHealthSampling();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { requestContextFromHeaders } = await import("@/lib/observability/context");
  const { captureException } = await import("@/lib/observability/server");
  const requestContext = requestContextFromHeaders(request.headers, context.routePath ?? request.path, request.path);
  captureException("next.request.unhandled_error", error, {
    scope: "next",
    operation: context.routeType ?? "request",
    route: requestContext.route,
    requestId: requestContext.requestId,
    safeContext: {
      errorDigest: extractErrorDigest(error),
      routeType: context.routeType,
      routerKind: context.routerKind,
      renderSource: context.renderSource,
    },
  });
};
