/** Only explicitly public buckets are eligible for URL materialization. */
const prefix = "storage://public/";
const publicBuckets = new Set(["team-logos", "season-public-assets"]);
const knownOrigins = new Set([
  "https://sucokfotkypwqkckfynp.supabase.co",
  "https://rrrebbxfghmgnoyyeqqd.supabase.co",
  "https://eurxkguokrkvpcsmxuru.supabase.co",
  "https://atjiukerfgqlwvnctigc.supabase.co",
  "https://ggkxqgbiudlovcgizgsq.supabase.co",
]);

/** Parse encoded path segments without allowing URL syntax or path traversal. */
export function parsePublicAssetReference(
  value: string,
): { bucket: string; path: string; encodedPath: string } | null {
  if (!value.startsWith(prefix) || /[?#\\]/.test(value)) return null;
  const parts = value.slice(prefix.length).split("/");
  const bucket = parts.shift();
  if (!bucket || !publicBuckets.has(bucket) || !parts.length || parts.some((part) => !part))
    return null;
  try {
    const decoded = parts.map((part) => decodeURIComponent(part));
    if (
      decoded.some(
        (part, i) =>
          part === "." ||
          part === ".." ||
          /[/\\%?#\u0000-\u001f\u007f]/u.test(part) ||
          encodeURIComponent(part).replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase()) !==
            parts[i]!.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase()),
      )
    )
      return null;
    return { bucket, path: decoded.join("/"), encodedPath: parts.join("/") };
  } catch {
    return null;
  }
}

/** Recognize old owned URLs for the preview mirror without guessing external buckets. */
export function parseOwnedPublicAssetUrl(value: string): { bucket: string; path: string } | null {
  try {
    const url = new URL(value);
    const current = process.env["NEXT_PUBLIC_SUPABASE_URL"]?.trim().replace(/\/$/, "");
    if (
      (!knownOrigins.has(url.origin) && url.origin !== current) ||
      value !== `${url.origin}${url.pathname}`
    )
      return null;
    const path = url.pathname.match(/^\/storage\/v1\/object\/public\/(.+)$/)?.[1];
    if (!path) return null;
    return parsePublicAssetReference(prefix + path);
  } catch {
    return null;
  }
}

/** Invalid internal references fail closed; opaque external URLs remain unchanged. */
export function displayPublicAsset(value: string): string {
  if (!value.startsWith(prefix)) return value;
  const ref = parsePublicAssetReference(value);
  if (!ref) return "";
  const base = process.env["NEXT_PUBLIC_SUPABASE_URL"]?.trim().replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/${ref.bucket}/${ref.encodedPath}` : "";
}
