import { AppError, ErrorCode } from "@/lib/errors";

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

export function integrationError(request: Request, error: unknown): Response {
  const appError = error instanceof AppError ? error : null;
  const status = appError?.code === ErrorCode.UNAUTHORIZED ? 401
    : appError?.code === ErrorCode.FORBIDDEN ? 403
      : appError?.code === ErrorCode.NOT_FOUND ? 404
        : appError?.code === ErrorCode.VALIDATION_FAILED ? 422
          : 500;
  return integrationJson(request, {
    error: {
      code: appError?.code ?? ErrorCode.INTERNAL_ERROR,
      message: appError?.message ?? "RivalHub 集成请求失败，请稍后重试。",
    },
  }, { status });
}
