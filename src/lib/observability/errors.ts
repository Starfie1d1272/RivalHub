import "server-only";

import { AppError, ErrorCode } from "@/lib/errors";
import { extractPgError, type PgErrorInfo } from "@/db/errors";
import { safeCode } from "@/lib/observability/redact";

export type ErrorClass = "expected" | "application" | "dependency" | "database" | "security" | "invariant";

export interface ErrorClassification {
  errorClass: ErrorClass;
  errorCode?: string;
  retryable: boolean;
  pg?: PgErrorInfo;
}

export interface ErrorClassificationOverrides {
  errorClass?: ErrorClass;
  errorCode?: string;
  retryable?: boolean;
  pgInfo?: PgErrorInfo | null;
}

export function classifyError(error: unknown, overrides: ErrorClassificationOverrides = {}): ErrorClassification {
  const pg = overrides.pgInfo === undefined ? extractPgError(error) : overrides.pgInfo ?? undefined;
  const defaultClass = getDefaultErrorClass(error, pg);
  const appErrorCode = error instanceof AppError ? error.code : undefined;
  return {
    errorClass: overrides.errorClass ?? defaultClass,
    errorCode: safeCode(overrides.errorCode ?? appErrorCode ?? pg?.code),
    retryable: overrides.retryable ?? (pg ? isRetryablePgCode(pg.code) : false),
    ...(pg ? { pg } : {}),
  };
}

function getDefaultErrorClass(error: unknown, pg: PgErrorInfo | null | undefined): ErrorClass {
  if (pg) return "database";
  if (error instanceof AppError) return error.code === ErrorCode.INTERNAL_ERROR ? "application" : "expected";

  const code = error instanceof Error ? error.name : "";
  if (/security|auth|csrf|forbidden|unauthorized/i.test(code)) return "security";
  if (/invariant|assert|integrity/i.test(code)) return "invariant";
  return "application";
}

function isRetryablePgCode(code: string): boolean {
  return code.startsWith("08") || code.startsWith("40") || code.startsWith("53") || code === "55P03" || code === "57P03" || code === "57014";
}
