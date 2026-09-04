import "server-only";

import { extractPgError, type PgErrorInfo } from "@/db/errors";

export interface SafeException {
  name?: string;
  message?: string;
  code?: string;
  constraint?: string;
  schema?: string;
  table?: string;
  column?: string;
  stack?: string;
}

const MAX_CAUSE_DEPTH = 8;
const MAX_TEXT_LENGTH = 600;
const MAX_STACK_LENGTH = 4_000;
const MAX_CONTEXT_KEYS = 24;
const MAX_ARRAY_ITEMS = 8;

const SAFE_CONTEXT_KEYS = new Set([
  "action",
  "attempt",
  "backend",
  "column",
  "connectionState",
  "constraint",
  "count",
  "durationMs",
  "errorClass",
  "errorCodes",
  "errorMessage",
  "errorName",
  "errorStack",
  "environment",
  "hostname",
  "host",
  "httpStatus",
  "imageBytes",
  "kind",
  "method",
  "mimeType",
  "model",
  "operation",
  "outcome",
  "phase",
  "provider",
  "providerCode",
  "queryOperation",
  "reason",
  "release",
  "renderSource",
  "responseFormat",
  "retryable",
  "routeType",
  "rowIndex",
  "schema",
  "spanKind",
  "stage",
  "status",
  "table",
  "workflow",
]);

const SENSITIVE_TEXT_PATTERN = /(?:password|passwd|secret|token(?:_hash)?|api[_-]?key|authorization|cookie|set-cookie|session|jwt|bearer|turnstile|evidence|education|verification(?:[_\s-]?code)|cron_secret)/i;
const SQL_TEXT_PATTERN = /(?:\$\d+|\b(?:select|insert|update|delete|alter|create|drop)\b(?:\s+|[(`])|(?:query|params?)\s*[:=])/i;

type ErrorObject = object | ((...args: never[]) => unknown);

function isObject(value: unknown): value is ErrorObject {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function readProperty(value: ErrorObject, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function readString(value: ErrorObject, property: string): string | undefined {
  const candidate = readProperty(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}

export function redactText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  let safe = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (SQL_TEXT_PATTERN.test(safe)) return "[REDACTED]";
  safe = safe
    .replace(/data:[^,;\s]+;base64,[A-Za-z0-9+/=]+/gi, "data:[REDACTED]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match) => `${match.split(/\s+/, 1)[0]} [REDACTED]`)
    .replace(/([?&](?:password|passwd|secret|token|token_hash|api[_-]?key|key|code)=[^&#\s]*)/gi, (match) => {
      const separator = match.slice(0, match.indexOf("=") + 1);
      return `${separator}[REDACTED]`;
    })
    .replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  if (SENSITIVE_TEXT_PATTERN.test(safe)) {
    safe = safe
      .replace(/\b(?:education\s+)?(?:verification\s+code|evidence|code)\s*[:=]\s*[^,\s}]+/gi, "[REDACTED]")
      .replace(/([A-Za-z_-]*(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|session|jwt|turnstile|evidence|education(?:[_-]?(?:evidence|code|verification[_-]?code))?|verification[_-]?code)[A-Za-z_-]*\s*[:=]\s*)[^,\s}]+/gi, "$1[REDACTED]");
  }
  return safe.slice(0, maxLength);
}

export function safeCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim();
  if (/^(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}$/i.test(code)) return undefined;
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : undefined;
}

export function extractSafeException(error: unknown, pgInfo: PgErrorInfo | null = extractPgError(error)): SafeException {
  if (pgInfo) {
    const result: SafeException = { name: "PostgreSQLError" };
    const code = safeCode(pgInfo.code);
    if (code) result.code = code;
    for (const property of ["constraint", "schema", "table", "column"] as const) {
      const value = redactText(pgInfo[property] ?? "", 160);
      if (value) result[property] = value;
    }
    return result;
  }

  const seen = new Set<ErrorObject>();
  let current: unknown = error;
  const result: SafeException = {};

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && isObject(current); depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    if (!result.name) result.name = redactText(readString(current, "name") ?? "Error", 120);
    if (!result.code) result.code = safeCode(readString(current, "code"));
    if (!result.message) {
      const message = readString(current, "message");
      if (message) result.message = redactText(message);
    }
    if (!result.stack) {
      const stack = readString(current, "stack");
      if (stack) result.stack = redactText(stack, MAX_STACK_LENGTH);
    }

    current = readProperty(current, "cause");
  }

  return result;
}

export function sanitizeSafeContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context || typeof context !== "object") return {};
  const result: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(context)) {
    if (count >= MAX_CONTEXT_KEYS || !SAFE_CONTEXT_KEYS.has(key)) continue;
    const safeValue = sanitizeContextValue(value);
    if (safeValue !== undefined) {
      result[key] = safeValue;
      count += 1;
    }
  }
  return result;
}

function sanitizeContextValue(value: unknown): string | number | boolean | string[] | undefined {
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const values = value.slice(0, MAX_ARRAY_ITEMS).map((item) => (typeof item === "string" ? redactText(item, 160) : undefined));
    return values.every((item): item is string => item !== undefined) ? values : undefined;
  }
  return undefined;
}
