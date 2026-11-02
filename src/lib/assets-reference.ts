/** Public asset references contain the bucket and URL-encoded object key.
 * External URLs remain opaque. Private storage never passes through this adapter. */
const prefix = "storage://public/";
const knownOrigins = new Set([
  "https://sucokfotkypwqkckfynp.supabase.co",
  "https://rrrebbxfghmgnoyyeqqd.supabase.co",
  "https://eurxkguokrkvpcsmxuru.supabase.co",
  "https://atjiukerfgqlwvnctigc.supabase.co",
  "https://ggkxqgbiudlovcgizgsq.supabase.co",
]);
class SignedAssetUrlError extends Error {}
const publicBuckets = new Set(["team-logos", "season-public-assets"]);

export function publicAssetReference(bucket: string, key: string): string {
  if (!publicBuckets.has(bucket) || !key) throw new Error("Invalid public asset identity");
  return prefix + bucket + "/" + key.split("/").map(encodeURIComponent).join("/");
}

export function storePublicAsset(value: string): string {
  if (value.startsWith(prefix)) return value;
  try {
    const url = new URL(value);
    if (/^\/storage\/v1\/(object|render\/image)\/sign\//.test(url.pathname)) throw new SignedAssetUrlError();
    const current = process.env["NEXT_PUBLIC_SUPABASE_URL"]?.trim().replace(/\/$/, "");
    if ((!knownOrigins.has(url.origin) && url.origin !== current) || value !== `${url.origin}${url.pathname}`) return value;
    const match = /^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (match && publicBuckets.has(match[1]!)) return prefix + match[1] + "/" + match[2];
  } catch (error) {
    if (error instanceof SignedAssetUrlError) throw error;
    /* external values are opaque */
  }
  return value;
}

export function displayPublicAsset(value: string): string {
  if (!value.startsWith(prefix)) return value;
  const path = value.slice(prefix.length);
  const slash = path.indexOf("/");
  if (slash < 1 || !publicBuckets.has(path.slice(0, slash))) return value;
  const base = process.env["NEXT_PUBLIC_SUPABASE_URL"]?.trim().replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/${path}` : value;
}

/** Decode only references known to point at public owned buckets. */
export function parsePublicAssetReference(value: string): { bucket: string; path: string } | null {
  if (!value.startsWith(prefix)) return null;
  const path = value.slice(prefix.length);
  const slash = path.indexOf("/");
  if (slash < 1 || !publicBuckets.has(path.slice(0, slash))) return null;
  try { return { bucket: path.slice(0, slash), path: decodeURIComponent(path.slice(slash + 1)) }; } catch { return null; }
}
