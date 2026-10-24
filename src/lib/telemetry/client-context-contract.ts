export const CLIENT_CATEGORIES = {
  device: ["mobile", "tablet", "desktop", "unknown"],
  browser: ["chrome", "safari", "firefox", "edge", "other"],
  os: ["windows", "macos", "linux", "android", "ios", "other"],
  source: ["none", "internal", "search", "social", "external", "unknown"],
} as const;
export type ClientContext = { [K in keyof typeof CLIENT_CATEGORIES]: (typeof CLIENT_CATEGORIES)[K][number] };
