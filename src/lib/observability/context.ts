import "server-only";

import { context as otelContext, createContextKey } from "@opentelemetry/api";

export interface RequestContext {
  route?: string;
  requestId?: string;
}

const REQUEST_CONTEXT_KEY = createContextKey("rivalhub.request-context");
const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id", "x-vercel-id"];
const ROUTE_HEADERS = ["x-matched-path", "x-nextjs-matched-path"];
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

export function normalizeRoute(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const route = value.split(/[?#]/, 1)[0]?.trim();
  if (!route || !route.startsWith("/") || /[\u0000-\u001f\u007f]/.test(route)) return undefined;
  return route.slice(0, 180);
}

export function normalizeRequestId(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const id = value.trim();
  if (!id || id.length > 128 || !SAFE_ID.test(id)) return undefined;
  return id;
}

export function createRequestContext(request: Request, route?: string): RequestContext {
  const headers = request.headers;
  return requestContextFromHeaders(headers, route, safeRequestPath(request.url));
}

export function requestContextFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
  route?: string,
  fallbackPath?: string,
): RequestContext {
  const requestId = REQUEST_ID_HEADERS.map((name) => readHeader(headers, name))
    .map(normalizeRequestId)
    .find(Boolean) ?? createRequestId();
  const matchedRoute = ROUTE_HEADERS.map((name) => readHeader(headers, name))
    .map(normalizeRoute)
    .find(Boolean);

  return {
    requestId,
    route: normalizeRoute(route) ?? matchedRoute ?? normalizeRoute(fallbackPath),
  };
}

export function getObservabilityContext(): RequestContext {
  return (otelContext.active().getValue(REQUEST_CONTEXT_KEY) as RequestContext | undefined) ?? {};
}

export function withObservabilityContext<T>(requestContext: RequestContext, callback: () => T): T {
  const current = getObservabilityContext();
  const merged: RequestContext = {
    ...current,
    ...requestContext,
    route: requestContext.route ?? current.route,
    requestId: requestContext.requestId ?? current.requestId,
  };
  return otelContext.with(otelContext.active().setValue(REQUEST_CONTEXT_KEY, merged), callback);
}

function readHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeRequestPath(value: string): string | undefined {
  try {
    return normalizeRoute(new URL(value).pathname);
  } catch {
    return normalizeRoute(value);
  }
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
