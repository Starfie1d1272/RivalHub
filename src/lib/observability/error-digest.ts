/** Next error hashes only: never coerce, trim or truncate arbitrary diagnostics. */
export function safeErrorDigest(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 1 && value.length <= 20 && !/[^0-9]/.test(value) ? value : undefined;
}

export function extractErrorDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    return safeErrorDigest(Reflect.get(error, "digest"));
  } catch {
    return undefined;
  }
}
