/** Evidence diagnostics v1 wire safety rules. Keep identical at producer/receiver. */
export const DIAGNOSTIC_LIMITS = { issues: 64, code: 96, path: 128, message: 320 } as const;
const REDACTED = "diagnostic.redacted";
// No credentials or per-run context, even when hidden inside a valid identifier.
const sensitive = /(?:token|secret|password|passwd|credential|authorization|cookie|api[ _-]?key|bearer|request[_-]?id|attempt|timestamp|raw[ _-]?log)/i;
const unsafeText = /(?:[a-z][a-z0-9+.-]*:\/\/|[a-z]:[\\/]|[\\/]|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b\d{17}\b|\b[A-Za-z0-9_-]{40,}\b|\b[\w.-]+\.(?:dem|zip|json|log|txt|env|pem|key)\b|\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b(?:at\s+\S+\s*\(|Error:|Traceback))/i;

export function sanitizeDiagnosticCode(value: string): string {
  return value.length <= DIAGNOSTIC_LIMITS.code && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) && !sensitive.test(value) && !unsafeText.test(value) && !/(?:^|[_.-])cause(?:$|[_.-])/i.test(value)
    ? value : REDACTED;
}

export function sanitizeDiagnosticPath(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.length <= DIAGNOSTIC_LIMITS.path && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*|\[\d+\])*$/.test(value) && !sensitive.test(value) && !unsafeText.test(value) && !/(?:^|[_.-])cause(?:$|[_.-])/i.test(value)
    ? value : REDACTED;
}

function unsafeMessage(value: string): boolean {
  return sensitive.test(value) || /\bcause\s*[:=]/i.test(value) || unsafeText.test(value);
}

export function sanitizeDiagnosticMessage(value: string): string {
  // Inspect before truncation so a clipped credential/path cannot escape detection.
  if (unsafeMessage(value)) return "[redacted]";
  const result = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, DIAGNOSTIC_LIMITS.message).trimEnd();
  // Normalization/truncation may expose a newly recognizable sensitive fragment.
  return !result || unsafeMessage(result) ? "[redacted]" : result;
}
