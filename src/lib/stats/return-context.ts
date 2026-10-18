/** Only the canonical local data center can supply a profile return destination. */
export function safeStatsReturn(value: string | null | undefined): string | null {
  if (!value || value.length > 2048 || !value.startsWith("/stats?") || value.includes("\\") || /[\r\n]/.test(value)) return null;
  const url = new URL(value, "https://rivalhub.invalid");
  if (url.pathname !== "/stats" || url.origin !== "https://rivalhub.invalid") return null;
  const allowed = new Set(["event", "tab", "stage", "format", "mapFilter", "teamFilter", "map", "mapsView", "recordPage", "sort", "direction", "page", "family", "q"]);
  for (const [key, item] of url.searchParams) if (!allowed.has(key) || item.length > 128) return null;
  return `/stats?${url.searchParams}`;
}
