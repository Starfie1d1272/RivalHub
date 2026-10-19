/** Metadata-only projection for providers whose messages can contain credentials or object paths. */
const CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "NoSuchKey", "NotFound", "NoSuchBucket", "AccessDenied", "InvalidJWT",
  "ResourceAlreadyExists", "EntityTooLarge", "InvalidMimeType", "InternalError", "DatabaseTimeout",
]);
const NAMES = new Set(["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError",
  "StorageError", "StorageApiError", "StorageUnknownError"]);

function read(value: object, key: string): unknown {
  try { return Reflect.get(value, key); } catch { return undefined; }
}
function status(value: unknown): number | undefined {
  const candidate = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : undefined;
}

export function providerFailureMetadata(error: unknown): {
  errorName: string; errorCodes: string[]; httpStatus?: number;
} {
  const result: { errorName: string; errorCodes: string[]; httpStatus?: number } = {
    errorName: "UnknownProviderError", errorCodes: [],
  };
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const name = read(current, "name");
    if (depth === 0 && typeof name === "string" && NAMES.has(name)) result.errorName = name;
    const code = read(current, "code");
    if (typeof code === "string" && CODES.has(code) && !result.errorCodes.includes(code)) result.errorCodes.push(code);
    result.httpStatus ??= status(read(current, "status")) ?? status(read(current, "statusCode"));
    current = read(current, "cause") ?? read(current, "originalError");
  }
  return result;
}
