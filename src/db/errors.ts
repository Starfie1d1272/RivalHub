import "server-only";

export interface PgErrorInfo {
  code: string;
  constraint?: string;
  schema?: string;
  table?: string;
  column?: string;
}

const MAX_CAUSE_DEPTH = 8;
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

type ErrorObject = object | ((...args: never[]) => unknown);

function isErrorObject(value: unknown): value is ErrorObject {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function readProperty(value: ErrorObject, property: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function readStringProperty(value: ErrorObject, property: string): string | undefined {
  const candidate = readProperty(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * Extract only non-sensitive PostgreSQL classification metadata from an
 * unknown thrown value. The traversal deliberately never reads query text,
 * parameters, detail, or the raw error object.
 */
export function extractPgError(error: unknown): PgErrorInfo | null {
  const seen = new Set<ErrorObject>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && isErrorObject(current); depth += 1) {
    if (seen.has(current)) return null;
    seen.add(current);

    const code = readStringProperty(current, "code");
    if (code && SQLSTATE_PATTERN.test(code)) {
      const info: PgErrorInfo = { code };
      for (const property of ["constraint", "schema", "table", "column"] as const) {
        const value = readStringProperty(current, property);
        if (value !== undefined) info[property] = value;
      }
      return info;
    }

    current = readProperty(current, "cause");
  }

  return null;
}

/** Match a unique violation only when its exact database constraint is known. */
export function isPgUniqueViolation(
  error: unknown,
  constraints: string | readonly string[],
): boolean {
  const info = extractPgError(error);
  if (!info || info.code !== "23505" || !info.constraint) return false;
  const allowed = typeof constraints === "string" ? [constraints] : constraints;
  return allowed.includes(info.constraint);
}
