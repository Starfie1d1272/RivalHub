const LOCAL_REDIRECT_ORIGIN = "http://rivalhub.local";

/**
 * Return only a same-site relative path. This is shared by the login page and
 * email callbacks so `//host` and browser-normalized backslash variants cannot
 * become open redirects.
 */
export function safeLocalRedirect(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;

  try {
    const parsed = new URL(raw, LOCAL_REDIRECT_ORIGIN);
    return parsed.origin === LOCAL_REDIRECT_ORIGIN ? raw : fallback;
  } catch {
    return fallback;
  }
}
