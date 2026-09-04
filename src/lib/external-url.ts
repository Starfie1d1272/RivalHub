/** URLs rendered as external links must use a browser-safe web scheme. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes an untrusted Steam profile URL into its canonical form.
 *
 * Requirements:
 * - Protocol must be exact https:
 * - Hostname must be exact steamcommunity.com (no credentials, no non-default port)
 * - Path must be either /profiles/<17-digit-steam64> or /id/<single-vanity-segment>
 * - Rejects encoded path separators (%2f, %5c) or raw backslashes, extra path segments, other Steam pages, malformed URLs
 * - Strips query, hash, trailing slashes, and leading/trailing whitespace
 * - Returns canonical URL string: `https://steamcommunity.com/profiles/<steam64>` or `https://steamcommunity.com/id/<vanity>`
 * - Returns null for any invalid or non-profile input
 */
export function normalizeSteamProfileUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.includes("\\") || /%2[fF]|%5[cC]/.test(trimmed)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "steamcommunity.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    return null;
  }

  const pathname = parsed.pathname;

  const profilesMatch = pathname.match(/^\/profiles\/(\d{17})\/?$/);
  if (profilesMatch) {
    return `https://steamcommunity.com/profiles/${profilesMatch[1]}`;
  }

  const idMatch = pathname.match(/^\/id\/([^/]+)\/?$/);
  if (idMatch) {
    const vanity = idMatch[1];
    let decodedVanity: string;
    try {
      decodedVanity = decodeURIComponent(vanity).trim();
    } catch {
      return null;
    }
    if (
      !decodedVanity ||
      decodedVanity === "." ||
      decodedVanity === ".." ||
      decodedVanity.includes("/") ||
      decodedVanity.includes("\\")
    ) {
      return null;
    }
    return `https://steamcommunity.com/id/${vanity}`;
  }

  return null;
}

export function isSteamProfileUrl(value: string | null | undefined): boolean {
  return normalizeSteamProfileUrl(value) !== null;
}
