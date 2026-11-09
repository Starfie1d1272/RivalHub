import { safeLocalRedirect } from "@/lib/auth/redirect";
import { isReservedSeasonSlug } from "@/lib/seasons/slug";

const LOCAL_ORIGIN = "http://rivalhub.local";
const ENTRY_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Settings and email flows carry only a registration route and an optional entry selector. */
export function safeRegistrationReturnPath(value: unknown): string | null {
  const local = safeLocalRedirect(typeof value === "string" ? value : undefined, "");
  if (!local) return null;
  const url = new URL(local, LOCAL_ORIGIN);
  const slug = /^\/([a-z0-9][a-z0-9-]*)\/register$/.exec(url.pathname)?.[1];
  if (!slug || isReservedSeasonSlug(slug) || url.pathname !== local.split(/[?#]/, 1)[0])
    return null;
  const [entry, duplicate] = url.searchParams.getAll("entry");
  if (entry && duplicate === undefined && ENTRY_ID.test(entry))
    return `${url.pathname}?${new URLSearchParams({ entry })}`;
  return url.pathname;
}

export function withRegistrationReturnPath(destination: string, value: unknown): string {
  const returnTo = safeRegistrationReturnPath(value);
  if (!returnTo) return destination;
  const url = new URL(destination, LOCAL_ORIGIN);
  url.searchParams.set("returnTo", returnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}
