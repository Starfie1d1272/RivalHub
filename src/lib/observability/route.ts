import "server-only";

import { after } from "next/server";
import { createRequestContext, withObservabilityContext } from "@/lib/observability/context";
import { flushObservability, logEvent, traceOperation } from "@/lib/observability/server";

export async function withRouteObservability<T extends Response>(
  request: Request,
  route: string,
  handler: () => Promise<T>,
): Promise<T> {
  const requestContext = createRequestContext(request, route);
  return withObservabilityContext(requestContext, () => traceOperation(
    `route.${request.method.toLowerCase()}`,
    {
      scope: "http",
      operation: request.method.toLowerCase(),
      route,
      attributes: {
        "http.request.method": request.method,
        "rivalhub.route": route,
      },
    },
    async (span) => {
      try {
        const response = await handler();
        span.setAttribute("http.response.status_code", response.status);
        if (response.status >= 500) {
          logEvent({
            level: "error",
            event: "http.response.server_error",
            scope: "http",
            operation: request.method.toLowerCase(),
            route,
            errorClass: "application",
            retryable: true,
            safeContext: { status: response.status },
          });
        }
        return response;
      } finally {
        try {
          after(() => flushObservability());
        } catch {
          // The response must not depend on the Next request context.
        }
      }
    },
  ));
}
