import "server-only";

import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { context as traceContext, SpanStatusCode, trace } from "@opentelemetry/api";
import { getObservabilityContext, normalizeRequestId, normalizeRoute } from "@/lib/observability/context";
import { classifyError, type ErrorClass, type ErrorClassificationOverrides } from "@/lib/observability/errors";
import { extractSafeException, redactText, safeCode, sanitizeSafeContext, type SafeException } from "@/lib/observability/redact";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface StructuredEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  scope: string;
  operation: string;
  errorClass?: ErrorClass;
  errorCode?: string;
  retryable?: boolean;
  route?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  release?: string;
  deployment?: string;
  environment: string;
  durationMs?: number;
  message?: string;
  exception?: SafeException;
  safeContext?: Record<string, unknown>;
}

export interface LogEventInput {
  level?: LogLevel;
  event: string;
  scope: string;
  operation: string;
  errorClass?: ErrorClass;
  errorCode?: string;
  retryable?: boolean;
  route?: string;
  requestId?: string;
  durationMs?: number;
  message?: string;
  exception?: SafeException;
  safeContext?: Record<string, unknown>;
}

export interface CaptureExceptionOptions extends ErrorClassificationOverrides {
  level?: LogLevel;
  route?: string;
  requestId?: string;
  durationMs?: number;
  message?: string;
  safeContext?: Record<string, unknown>;
  scope: string;
  operation: string;
  provider?: string;
}

const logger = logs.getLogger("rivalhub");

function buildStructuredEvent(input: LogEventInput, now = new Date()): StructuredEvent {
  const requestContext = getObservabilityContext();
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();
  const runtimeEnv = typeof process === "undefined" ? undefined : process.env;
  const environment = runtimeEnv?.VERCEL_ENV ?? runtimeEnv?.NODE_ENV ?? "unknown";
  const release = runtimeEnv?.VERCEL_GIT_COMMIT_SHA ?? runtimeEnv?.GIT_COMMIT_SHA;
  const deployment = runtimeEnv?.VERCEL_DEPLOYMENT_ID;

  const event: StructuredEvent = {
    timestamp: now.toISOString(),
    level: input.level ?? "info",
    event: safeIdentifier(input.event, "event"),
    scope: safeIdentifier(input.scope, "scope"),
    operation: safeIdentifier(input.operation, "operation"),
    environment: safeIdentifier(environment, "unknown"),
  };

  const route = normalizeRoute(input.route ?? requestContext.route);
  const requestId = normalizeRequestId(input.requestId ?? requestContext.requestId);
  if (route) event.route = route;
  if (requestId) event.requestId = requestId;
  if (spanContext?.traceId) event.traceId = spanContext.traceId;
  if (spanContext?.spanId) event.spanId = spanContext.spanId;
  if (release) event.release = safeIdentifier(release, "unknown");
  if (deployment) event.deployment = safeIdentifier(deployment, "unknown");
  if (input.errorClass) event.errorClass = input.errorClass;
  if (input.errorCode) event.errorCode = safeIdentifier(input.errorCode, "unknown");
  if (input.retryable !== undefined) event.retryable = input.retryable;
  if (input.durationMs !== undefined && Number.isFinite(input.durationMs)) {
    event.durationMs = Math.max(0, Math.min(Math.round(input.durationMs), 86_400_000));
  }
  if (input.message) event.message = redactText(input.message);
  const exception = sanitizeException(input.exception);
  if (exception && Object.keys(exception).length > 0) event.exception = exception;
  const safeContext = sanitizeSafeContext(input.safeContext);
  if (Object.keys(safeContext).length > 0) event.safeContext = safeContext;
  return event;
}

export function logEvent(input: LogEventInput): StructuredEvent {
  const event = buildStructuredEvent(input);
  const serialized = safeSerialize(event);
  try {
    const streams = getRuntimeStreams();
    const stream = event.level === "debug" || event.level === "info"
      ? streams?.stdout
      : streams?.stderr;
    stream?.write(`${serialized}\n`);
  } catch {
    // Logging is best effort and must never change the core request result.
  }

  try {
    logger.emit({
      eventName: event.event,
      severityText: event.level.toUpperCase(),
      severityNumber: severityFor(event.level),
      body: serialized,
      attributes: flattenAttributes(event),
      context: traceContext.active(),
    });
  } catch {
    // An unavailable exporter must not break the request.
  }
  return event;
}

interface RuntimeStreams {
  stdout?: { write: (value: string) => unknown };
  stderr?: { write: (value: string) => unknown };
}

function getRuntimeStreams(): RuntimeStreams | undefined {
  const runtime = (globalThis as typeof globalThis & { process?: unknown }).process;
  return runtime && typeof runtime === "object" ? runtime as RuntimeStreams : undefined;
}

export function captureException(event: string, error: unknown, options: CaptureExceptionOptions): StructuredEvent | undefined {
  try {
    const pgInfo = options.pgInfo === undefined ? undefined : options.pgInfo;
    const classification = classifyError(error, { ...options, ...(pgInfo !== undefined ? { pgInfo } : {}) });
    const exception = extractSafeException(error, classification.pg ?? null);
    const safeContext = {
      ...options.safeContext,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(classification.pg?.constraint ? { constraint: classification.pg.constraint } : {}),
      ...(classification.pg?.schema ? { schema: classification.pg.schema } : {}),
      ...(classification.pg?.table ? { table: classification.pg.table } : {}),
      ...(classification.pg?.column ? { column: classification.pg.column } : {}),
    };
    const logged = logEvent({
      level: options.level ?? levelFor(classification.errorClass),
      event,
      scope: options.scope,
      operation: options.operation,
      errorClass: classification.errorClass,
      errorCode: classification.errorCode,
      retryable: classification.retryable,
      route: options.route,
      requestId: options.requestId,
      durationMs: options.durationMs,
      message: options.message,
      exception,
      safeContext,
    });
    recordExceptionOnActiveSpan(exception, classification);
    return logged;
  } catch {
    return undefined;
  }
}

function recordExceptionOnActiveSpan(exception: SafeException, classification: { errorClass: ErrorClass; errorCode?: string }): void {
  try {
    const span = trace.getActiveSpan();
    if (!span) return;
    const record = {
      name: exception.name ?? "Error",
      ...(exception.message ? { message: exception.message } : {}),
      ...(exception.stack ? { stack: exception.stack } : {}),
    };
    span.recordException(record);
    span.setAttribute("rivalhub.error_class", classification.errorClass);
    if (classification.errorCode) span.setAttribute("rivalhub.error_code", classification.errorCode);
    span.setStatus({ code: SpanStatusCode.ERROR });
  } catch {
    // Span recording is best effort.
  }
}

function safeSerialize(value: StructuredEvent): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      timestamp: value.timestamp,
      level: value.level,
      event: value.event,
      scope: value.scope,
      operation: value.operation,
      environment: value.environment,
    });
  }
}

function flattenAttributes(event: StructuredEvent): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {
    "rivalhub.event": event.event,
    "rivalhub.scope": event.scope,
    "rivalhub.operation": event.operation,
    "rivalhub.environment": event.environment,
  };
  for (const [key, value] of Object.entries(event)) {
    if (key === "timestamp" || key === "safeContext" || key === "exception" || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[`rivalhub.${key}`] = value;
    }
  }
  return attributes;
}

function severityFor(level: LogLevel): SeverityNumber {
  switch (level) {
    case "debug": return SeverityNumber.DEBUG;
    case "info": return SeverityNumber.INFO;
    case "warn": return SeverityNumber.WARN;
    case "error": return SeverityNumber.ERROR;
    case "fatal": return SeverityNumber.FATAL;
  }
}

function levelFor(errorClass: ErrorClass): LogLevel {
  return errorClass === "invariant" ? "fatal" : "error";
}

function safeIdentifier(value: string, fallback: string): string {
  const safe = redactText(value, 160).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 160);
  return safe || fallback;
}

function sanitizeException(exception: SafeException | undefined): SafeException | undefined {
  if (!exception) return undefined;
  const safe: SafeException = {};
  if (exception.name) safe.name = redactText(exception.name, 120);
  if (exception.message) safe.message = redactText(exception.message);
  if (exception.code) safe.code = safeCode(exception.code);
  if (exception.constraint) safe.constraint = redactText(exception.constraint, 160);
  if (exception.schema) safe.schema = redactText(exception.schema, 160);
  if (exception.table) safe.table = redactText(exception.table, 160);
  if (exception.column) safe.column = redactText(exception.column, 160);
  if (exception.stack) safe.stack = redactText(exception.stack, 4_000);
  return safe;
}
