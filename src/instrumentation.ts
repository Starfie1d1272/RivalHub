import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    const { registerEdgeObservability } = await import("@/lib/observability/instrumentation-edge");
    registerEdgeObservability();
    return;
  }
  const { registerNodeObservability } = await import("@/lib/observability/instrumentation-node");
  registerNodeObservability();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { requestContextFromHeaders } = await import("@/lib/observability/context");
  const { captureException } = await import("@/lib/observability/logger");
  const requestContext = requestContextFromHeaders(request.headers, context.routePath ?? request.path, request.path);
  captureException("next.request.unhandled_error", error, {
    scope: "next",
    operation: context.routeType ?? "request",
    route: requestContext.route,
    requestId: requestContext.requestId,
    safeContext: {
      routeType: context.routeType,
      routerKind: context.routerKind,
      renderSource: context.renderSource,
    },
  });
};
