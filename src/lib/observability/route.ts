import "server-only";

import { createRequestContext, withObservabilityContext, type RequestContext } from "@/lib/observability/context";
import { logEvent } from "@/lib/observability/server";

export async function withRouteObservability<T extends Response>(
  request: Request,
  route: string,
  handler: (requestContext: RequestContext) => Promise<T>,
  options: { captureServerErrorResponse?: boolean } = {},
): Promise<T> {
  const requestContext = createRequestContext(request, route);
  return withObservabilityContext(requestContext, async () => {
    const response = await handler(requestContext);
    if (response.status >= 500 && options.captureServerErrorResponse !== false) {
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
  });
}
