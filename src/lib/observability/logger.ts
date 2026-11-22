import {
  getObservabilityContext,
  normalizeRequestId,
  normalizeRoute,
} from "@/lib/observability/context";
import {
  classifyError,
  type ErrorClass,
  type ErrorClassificationOverrides,
} from "@/lib/observability/errors";
import {
  extractSafeException,
  redactText,
  sanitizeSafeContext,
  type SafeException,
} from "@/lib/observability/redact";

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

function buildStructuredEvent(input: LogEventInput, now = new Date()): StructuredEvent {
  const requestContext = getObservabilityContext();
  const runtimeEnv = typeof process === "undefined" ? undefined : process.env;
  const environment = runtimeEnv?.VERCEL_ENV ?? runtimeEnv?.NODE_ENV ?? "unknown";
  const release =
    runtimeEnv?.VERCEL_GIT_COMMIT_SHA?.trim() ||
    runtimeEnv?.GIT_COMMIT_SHA?.trim() ||
    runtimeEnv?.VERCEL_DEPLOYMENT_ID?.trim();
  const deployment = runtimeEnv?.VERCEL_DEPLOYMENT_ID?.trim();

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
  writeEvent(event, safeSerialize(event));
  return event;
}

/** True means the structured event was handed to the local stream; downstream delivery remains best effort. */
export function tryLogEvent(input: LogEventInput): boolean {
  try {
    const event = buildStructuredEvent(input);
    return writeEvent(event, JSON.stringify(event));
  } catch {
    return false;
  }
}

type BackpressureState = { blocked: boolean; dropped: number; firstError: string | null };
const backpressureSlot = Symbol.for("rivalhub.log-backpressure.v1");
const runtimeState = globalThis as typeof globalThis & {
  [backpressureSlot]?: WeakMap<object, BackpressureState>;
};
const backpressure = (runtimeState[backpressureSlot] ??= new WeakMap<object, BackpressureState>());

function writeEvent(event: StructuredEvent, serialized: string): boolean {
  try {
    const streams = getRuntimeStreams();
    const stream =
      event.level === "debug" || event.level === "info" ? streams?.stdout : streams?.stderr;
    if (!stream) return false;
    let state = backpressure.get(stream);
    if (!state) {
      state = { blocked: false, dropped: 0, firstError: null };
      backpressure.set(stream, state);
    }
    if (state.blocked) {
      state.dropped = Math.min(state.dropped + 1, Number.MAX_SAFE_INTEGER);
      if (!state.firstError && (event.level === "error" || event.level === "fatal"))
        state.firstError = serialized;
      return false;
    }
    if (stream.write(`${serialized}\n`) === false && stream.once) {
      state.blocked = true;
      const current = state;
      const resume = () => {
        current.blocked = false;
        if (!current.dropped) return;
        const count = current.dropped;
        const firstError = current.firstError;
        current.dropped = 0;
        current.firstError = null;
        try {
          const accepted = stream.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "warn",
              event: "runtime.log.backpressure",
              scope: "runtime",
              operation: "log.write",
              environment: event.environment,
              safeContext: { count: count - (firstError ? 1 : 0) },
            })}\n`,
          );
          const errorAccepted = firstError ? stream.write(`${firstError}\n`) : true;
          if (
            (accepted === false || errorAccepted === false || stream.writableNeedDrain) &&
            stream.once
          ) {
            current.blocked = true;
            stream.once("drain", resume);
          }
        } catch {
          // Diagnostics remain best effort if the stream closes.
        }
      };
      stream.once("drain", resume);
    }
    return true;
  } catch {
    // Logging is best effort and must never change the core request result.
    return false;
  }
}

interface RuntimeStreams {
  stdout?: {
    write: (value: string) => unknown;
    once?: (event: "drain", listener: () => void) => unknown;
    writableNeedDrain?: boolean;
  };
  stderr?: {
    write: (value: string) => unknown;
    once?: (event: "drain", listener: () => void) => unknown;
    writableNeedDrain?: boolean;
  };
}

function getRuntimeStreams(): RuntimeStreams | undefined {
  const runtime = (globalThis as typeof globalThis & { process?: unknown }).process;
  return runtime && typeof runtime === "object" ? (runtime as RuntimeStreams) : undefined;
}

export function captureException(
  event: string,
  error: unknown,
  options: CaptureExceptionOptions,
): StructuredEvent | undefined {
  try {
    const pgInfo = options.pgInfo === undefined ? undefined : options.pgInfo;
    const classification = classifyError(error, {
      ...options,
      ...(pgInfo !== undefined ? { pgInfo } : {}),
    });
    const expected = classification.errorClass === "expected";
    const exception = expected ? undefined : extractSafeException(error, classification.pg ?? null);
    const safeContext = {
      ...sanitizeSafeContext(options.safeContext),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(classification.pg?.constraint ? { constraint: classification.pg.constraint } : {}),
      ...(classification.pg?.schema ? { schema: classification.pg.schema } : {}),
      ...(classification.pg?.table ? { table: classification.pg.table } : {}),
      ...(classification.pg?.column ? { column: classification.pg.column } : {}),
    };
    const logged = logEvent({
      level: options.level ?? (expected ? "info" : levelFor(classification.errorClass)),
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
    return logged;
  } catch {
    return undefined;
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

function levelFor(errorClass: ErrorClass): LogLevel {
  return errorClass === "invariant" ? "fatal" : "error";
}

function safeIdentifier(value: string, fallback: string): string {
  const safe = redactText(value, 160)
    .replace(/[^A-Za-z0-9_.:/-]/g, "_")
    .slice(0, 160);
  return safe || fallback;
}

function sanitizeException(exception: SafeException | undefined): SafeException | undefined {
  if (!exception) return undefined;
  return extractSafeException(exception);
}
