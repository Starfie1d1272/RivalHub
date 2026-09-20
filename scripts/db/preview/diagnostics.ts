import { captureException, type StructuredEvent } from "../../../src/lib/observability/logger";
import { redactText, safeCode } from "../../../src/lib/observability/redact";

export type PreviewExportPhase =
  | "source identity"
  | "source DB connection"
  | "migration ledger"
  | "schema inventory-policy"
  | "table export"
  | "persona selection"
  | "public asset export"
  | "snapshot write";

export type PreviewRefreshPhase =
  | "snapshot read"
  | "dev storage preflight"
  | "db connection"
  | "db reset"
  | "db migrate"
  | "db import"
  | "db state setup"
  | "persona auth"
  | "persona db binding"
  | "public asset upload"
  | "mirror state commit";

export type PreviewMirrorPhase = PreviewExportPhase | PreviewRefreshPhase;

export type PreviewErrorCode =
  | "PREVIEW_PHASE_FAILED"
  | "PREVIEW_MIGRATION_LEDGER_FAILED"
  | "PREVIEW_SCHEMA_POLICY_INVALID"
  | "UNREVIEWED_MIRROR_TABLE"
  | "FUTURE_MIRROR_TABLE"
  | "UNREVIEWED_MIRROR_COLUMNS"
  | "REMOVED_MIRROR_COLUMNS"
  | "MISSING_MIRROR_COLUMNS"
  | "MISSING_MIRROR_TABLE"
  | "PREVIEW_TABLE_EXPORT_FAILED"
  | "PREVIEW_PERSONA_SELECTION_FAILED"
  | "PREVIEW_ASSET_EXPORT_FAILED"
  | "PREVIEW_SNAPSHOT_INVALID"
  | "PREVIEW_SNAPSHOT_WRITE_FAILED"
  | "PREVIEW_STORAGE_FAILED"
  | "PREVIEW_REFRESH_FAILED";

export interface PreviewDiagnosticContext {
  phase?: PreviewMirrorPhase;
  table?: string;
  column?: string;
  schema?: string;
  provider?: string;
  providerCode?: string;
  httpStatus?: number;
  retryable?: boolean;
  source?: string;
  count?: number;
}

export interface PreviewMirrorErrorOptions {
  cause?: unknown;
  context?: PreviewDiagnosticContext;
  retryable?: boolean;
}

export class PreviewMirrorError extends Error {
  readonly code: PreviewErrorCode;
  readonly phase?: PreviewMirrorPhase;
  readonly context: PreviewDiagnosticContext;
  readonly retryable: boolean;

  constructor(code: PreviewErrorCode, message: string, options: PreviewMirrorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PreviewMirrorError";
    this.code = code;
    this.context = { ...options.context };
    this.phase = this.context.phase;
    this.retryable = options.retryable ?? this.context.retryable ?? false;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PreviewRefreshPhaseError extends PreviewMirrorError {
  constructor(phase: PreviewRefreshPhase, cause: unknown) {
    const inner = previewErrorDetails(cause);
    super(inner.code ?? "PREVIEW_PHASE_FAILED", `Preview mirror phase failed: ${phase}`, {
      cause,
      context: { ...inner.context, phase },
      retryable: inner.retryable,
    });
    this.name = "PreviewRefreshPhaseError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PreviewErrorDetails {
  code?: PreviewErrorCode;
  phase?: PreviewMirrorPhase;
  context: PreviewDiagnosticContext;
  retryable: boolean;
}

export function previewErrorDetails(error: unknown): PreviewErrorDetails {
  const seen = new Set<object>();
  let current: unknown = error;
  while (isObject(current) && !seen.has(current)) {
    seen.add(current);
    if (current instanceof PreviewMirrorError) {
      return {
        code: current.code,
        phase: current.phase,
        context: { ...current.context, ...(current.phase ? { phase: current.phase } : {}) },
        retryable: current.retryable,
      };
    }
    current = readCause(current);
  }
  return { context: {}, retryable: false };
}

export function wrapPreviewPhase(
  phase: PreviewExportPhase,
  error: unknown,
  fallbackCode: PreviewErrorCode = "PREVIEW_PHASE_FAILED",
): PreviewMirrorError {
  if (error instanceof PreviewMirrorError && error.phase === phase) return error;
  const inner = previewErrorDetails(error);
  return new PreviewMirrorError(inner.code ?? fallbackCode, `Preview mirror phase failed: ${phase}`, {
    cause: error,
    context: { ...inner.context, phase },
    retryable: inner.retryable,
  });
}

export function previewProviderFailure(
  phase: PreviewRefreshPhase | "public asset export",
  error: unknown,
  context: Omit<PreviewDiagnosticContext, "phase" | "provider" | "providerCode" | "httpStatus" | "retryable"> = {},
): PreviewMirrorError {
  const providerCode = readSafeCode(error, "code");
  const httpStatus = readHttpStatus(error);
  const retryable = httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500);
  return new PreviewMirrorError("PREVIEW_STORAGE_FAILED", `Preview mirror provider operation failed during ${phase}.`, {
    cause: error,
    context: {
      ...context,
      phase,
      provider: "supabase",
      ...(providerCode ? { providerCode } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      retryable,
    },
    retryable,
  });
}

export function reportPreviewFailure(
  event: string,
  error: unknown,
  options: { operation: string; source?: string },
): StructuredEvent | undefined {
  const details = previewErrorDetails(error);
  const context = {
    ...details.context,
    ...(details.phase ? { phase: details.phase } : {}),
    ...(options.source ? { source: options.source } : {}),
  };
  const logged = captureException(event, error, {
    scope: "preview_mirror",
    operation: options.operation,
    errorClass: errorClassFor(details.code),
    errorCode: details.code ?? "PREVIEW_REFRESH_FAILED",
    retryable: details.retryable,
    safeContext: context,
  });
  const summary = [
    "Preview mirror failed",
    `phase=${details.phase ?? "unknown"}`,
    `code=${details.code ?? "PREVIEW_REFRESH_FAILED"}`,
    ...(details.context.table ? [`table=${safeSummaryText(details.context.table)}`] : []),
    ...(details.context.column ? [`column=${safeSummaryText(details.context.column)}`] : []),
    ...(details.context.provider ? [`provider=${safeSummaryText(details.context.provider)}`] : []),
    ...(details.context.providerCode ? [`providerCode=${safeSummaryText(details.context.providerCode)}`] : []),
    ...(details.context.httpStatus !== undefined ? [`httpStatus=${details.context.httpStatus}`] : []),
  ].join(" ");
  console.error(`${summary}; provider errors and row values are not logged.`);
  return logged;
}

function errorClassFor(code: PreviewErrorCode | undefined): "application" | "dependency" | "invariant" {
  if (code === "PREVIEW_STORAGE_FAILED") return "dependency";
  if (code?.includes("MIRROR") || code === "PREVIEW_SCHEMA_POLICY_INVALID" || code === "PREVIEW_MIGRATION_LEDGER_FAILED") return "invariant";
  return "application";
}

function safeSummaryText(value: string): string {
  return redactText(value, 160).replace(/[^\x20-\x7e]/g, " ").replace(/[\r\n]/g, " ");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function readCause(value: object): unknown {
  try {
    return Reflect.get(value, "cause");
  } catch {
    return undefined;
  }
}

function readSafeCode(value: unknown, property: string): string | undefined {
  if (!isObject(value)) return undefined;
  try {
    return safeCode(Reflect.get(value, property));
  } catch {
    return undefined;
  }
}

function readHttpStatus(value: unknown): number | undefined {
  if (!isObject(value)) return undefined;
  for (const property of ["status", "statusCode"] as const) {
    try {
      const candidate = Reflect.get(value, property);
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) return candidate;
      if (typeof candidate === "string" && /^[1-5][0-9]{2}$/.test(candidate)) return Number(candidate);
    } catch {
      // Provider metadata is best effort; never read its message or body.
    }
  }
  return undefined;
}
