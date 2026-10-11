/** Evidence diagnostics v1 wire safety rules. Keep identical at producer/receiver. */
export const DIAGNOSTIC_LIMITS = { issues: 64, code: 96, path: 128, message: 320 } as const;
const REDACTED = "diagnostic.redacted";
const RAW_DIAGNOSTIC = "[redacted: raw diagnostic]";
// Identifiers cannot carry credentials or run-specific fields. Match whole
// segments: future.tokenCount and attempts.coverage remain valid future codes.
const sensitiveIdentifier = /(?:^|[_.-])(?:accessToken|refreshToken|token|secret|password|passwd|credential|authorization|cookie|apiKey|api_key|bearer|requestId|request_id|attempt|timestamp|cause|rawLog|raw_log)(?:$|[_.-])/i;
const identifierPayload = /(?:\b\d{17}\b|[A-Za-z0-9_-]{40,}|\.(?:dem|zip|json|log|txt|env|pem|key)$)/i;

export function sanitizeDiagnosticCode(value: string): string {
  return value.length <= DIAGNOSTIC_LIMITS.code && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
    && !sensitiveIdentifier.test(value) && !identifierPayload.test(value) ? value : REDACTED;
}

export function sanitizeDiagnosticPath(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.length <= DIAGNOSTIC_LIMITS.path && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*|\[\d+\])*$/.test(value)
    && !sensitiveIdentifier.test(value) && !identifierPayload.test(value) ? value : REDACTED;
}

function redactFragments(value: string): string {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, "[redacted]")
    .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=]\s*.*/gi, "[redacted]")
    // Quoted values can contain spaces, escaped quotes and delimiters. For an
    // unquoted credential, suppress the rest of its clause rather than guessing
    // where a multi-word secret ends. Keep the preceding QA explanation.
    .replace(/\b(?:access[ _-]?token|refresh[ _-]?token|token|secret|password|passwd|credential|authorization|cookie|set-cookie|api[ _-]?key)\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*$|'(?:\\.|[^'\\])*$|[^;,]*)/gi, "[redacted]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, "[redacted]")
    .replace(/\b(?:request[ _-]?id|attempt|timestamp|cause)\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*$|'(?:\\.|[^'\\])*$|[^;,]*)/gi, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    // A slash is not itself private: keep 1/2 and playerStats/kills. Paths
    // require an absolute/relative prefix or a known file suffix.
    .replace(/"(?:[a-z]:[\\/]|\/|\.\.?[\\/])[^"\r\n]*"|'(?:[a-z]:[\\/]|\/|\.\.?[\\/])[^'\r\n]*'/gi, "[redacted]")
    .replace(/(?:\b[a-z]:[\\/]|\\\\|\.\.?[\\/])[^\s<>"']+/gi, "[redacted]")
    .replace(/(^|[\s(=:])\/[^\s<>"')]+/g, "$1[redacted]")
    .replace(/(?:[\w.-]+[\\/])*[\w.-]+\.(?:dem|zip|json|log|txt|env|pem|key)\b/gi, "[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[redacted]")
    .replace(/\b\d{17}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "[redacted]");
}

export function sanitizeDiagnosticMessage(value: string): string {
  // Raw runtime output is not a QA explanation. The safe code/path are kept by
  // the caller, while this marker explicitly explains why prose was suppressed.
  if (/\bTraceback\s*\(|(?:^|\n)\s*at\s+[^\n]*:\d+(?::\d+)?\)?\s*(?:\n|$)|\b(?:raw[ _-]?log|stacktrace)\s*:/i.test(value)) return RAW_DIAGNOSTIC;
  let result = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ").trim();
  // Redact before bounding so truncation cannot expose part of a secret. A
  // second pass also handles a file suffix made recognizable by truncation.
  while (true) {
    const next = redactFragments(result).slice(0, DIAGNOSTIC_LIMITS.message).trimEnd();
    if (next === result) return next || "[redacted]";
    result = next;
  }
}
