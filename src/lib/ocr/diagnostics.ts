import "server-only";

import { extractSafeException, redactText } from "@/lib/observability/redact";

export interface OCRDiagnostic {
  name: string;
  code: string;
  message: string;
}

function readData(value: object, key: string): unknown {
  // Do not invoke getters on arbitrary provider exceptions.
  let source: object | null = value;
  for (let depth = 0; source && depth < 3; depth++) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      source = Object.getPrototypeOf(source);
    } catch { return undefined; }
  }
  return undefined;
}

function diagnosticText(value: string, sensitiveValues: readonly string[]): string {
  let text = value;
  // Also remove exact request credentials/image bytes if a provider echoes
  // them without an identifying label. These values never enter the result.
  for (const secret of sensitiveValues) if (secret) text = text.replaceAll(secret, "[REDACTED]");
  text = text
    .replace(/\bhttps?:\/\/[^\s<>"']+/gi, url => {
      try { return `${new URL(url).origin}/[REDACTED_URL_DETAILS]`; }
      catch { return "[REDACTED_URL]"; }
    })
    .replace(/\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{8,}\b/gi, "[REDACTED_KEY]")
    .replace(/[A-Za-z0-9+/]{100,}={0,2}/g, "[REDACTED_DATA]");
  // Reuse the canonical credential, email, SQL and data-URL redaction boundary.
  return redactText(text, 160);
}

/** A bounded server-only projection, not storage of a raw exception/body. */
export function extractOCRDiagnostics(error: unknown, sensitiveValues: readonly string[] = []): OCRDiagnostic[] {
  const result: OCRDiagnostic[] = [];
  const seen = new Set<object>();
  let current = typeof error === "string" ? { name: "NonErrorThrow", message: error } : error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const name = readData(current, "name");
    const message = readData(current, "message");
    const code = readData(current, "code");
    // Select only scalar diagnostics before using the shared exception sanitizer;
    // request headers, payloads, stacks and other arbitrary object fields stay out.
    const safe = extractSafeException({
      name: diagnosticText(typeof name === "string" ? name : "ProviderError", sensitiveValues),
      message: typeof message === "string" ? diagnosticText(message, sensitiveValues) : undefined,
      code: typeof code === "string" || typeof code === "number" && Number.isFinite(code)
        ? diagnosticText(String(code), sensitiveValues) : undefined,
    }, null);
    if (safe.message || safe.code) result.push({ name: safe.name ?? "ProviderError", code: safe.code ?? "", message: safe.message ?? "" });
    const cause = readData(current, "cause");
    current = typeof cause === "string" ? { name: "ProviderCause", message: cause } : cause;
  }
  return result;
}
