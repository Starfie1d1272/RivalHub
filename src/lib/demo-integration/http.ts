import "server-only";

import { withDbTrafficSource, DB_SOURCES, type DbTrafficSource } from "@/lib/observability/db-traffic";
import { ensureRequestId } from "@/lib/observability/context";
import { withRouteObservability } from "@/lib/observability/route";
import { captureException } from "@/lib/observability/server";
import { classifyError } from "@/lib/observability/errors";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

type IntegrationPhase = "auth" | "read" | "validate" | "domain" | "revalidation";
interface IntegrationDiagnostics { operation: string; phase: IntegrationPhase; requestId: string; route: string }

/** Capture handled failures once, inside the shared request/flush boundary. */
export function withIntegrationRequest(
  request: Request,
  route: string,
  operation: string,
  handler: (diagnostics: IntegrationDiagnostics) => Promise<Response>,
): Promise<Response> {
  const candidate = `dak.${operation}`;
  const source: DbTrafficSource = (DB_SOURCES as readonly string[]).includes(candidate) ? candidate as DbTrafficSource : "dak";
  return withDbTrafficSource(source, () => withRouteObservability(request, route, async (requestContext) => {
    const diagnostics: IntegrationDiagnostics = { operation, phase: "auth", requestId: ensureRequestId(requestContext.requestId), route };
    try {
      return await handler(diagnostics);
    } catch (error) {
      return integrationError(request, error, diagnostics);
    }
  }, { captureServerErrorResponse: false }));
}

const ALLOWED_METHODS = "GET, POST, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, Idempotency-Key";

function isAllowedOrigin(origin: string): boolean {
  const configured = process.env.DAK_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean);
  if (configured?.length) return configured.includes(origin);
  // The desktop WebView normally sends Origin: null. No cookie is accepted by
  // these handlers, and the long-lived credential is held by the Studio app.
  return origin === "null" || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
}

export function integrationHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  });
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function integrationJson(request: Request, body: unknown, init?: ResponseInit): Response {
  const headers = integrationHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(init?.headers ?? {})) headers.set(key, String(value));
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function integrationOptions(request: Request): Response {
  return new Response(null, { status: 204, headers: integrationHeaders(request) });
}

export function integrationError(request: Request, error: unknown, diagnostics?: IntegrationDiagnostics): Response {
  const appError = error instanceof AppError ? error : null;
  const status = appError?.code === ErrorCode.UNAUTHORIZED ? 401
    : appError?.code === ErrorCode.FORBIDDEN ? 403
      : appError?.code === ErrorCode.NOT_FOUND ? 404
        : appError?.code === ErrorCode.VALIDATION_FAILED ? 422
          : 500;
  if (status < 500) {
    return integrationJson(request, {
      error: { code: appError!.code, message: appError!.presentation?.message ?? appError!.message },
    }, { status });
  }
  const requestId = ensureRequestId(diagnostics?.requestId);
  const classification = classifyError(error);
  captureException("dak.request.failure", error, {
    scope: "dak", operation: diagnostics?.operation ?? "request", requestId, route: diagnostics?.route,
    errorClass: classification.errorClass === "expected" ? "application" : classification.errorClass,
    errorCode: classification.errorCode ?? ErrorCode.INTERNAL_ERROR,
    safeContext: { phase: diagnostics?.phase ?? "domain", httpStatus: status },
  });
  const message = diagnostics?.phase === "revalidation"
    ? "已收到提交，请先查看保存结果并核对导入状态，不要重新上传；如无法查看，请联系管理员。"
    : `${ERROR_MESSAGES.INTERNAL_ERROR}。请先刷新核对操作结果；如仍有问题，请联系管理员。`;
  // Keep the published error wire shape: strict desktop parsers accept code/message.
  return integrationJson(request, {
    error: { code: ErrorCode.INTERNAL_ERROR, message: `${message}排查编号：${requestId}` },
  }, { status, headers: { "X-Request-Id": requestId } });
}
