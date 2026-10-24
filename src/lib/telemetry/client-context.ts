import type { ClientContext } from "./protocol";

/** Inputs are classified in browser memory; only these fixed categories leave the page. */
export function classifyClient(userAgent: string, touchPoints: number, referrer: string, origin: string): ClientContext {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  const tablet = /iPad|Tablet/.test(userAgent) || (/Android/.test(userAgent) && !/Mobile/.test(userAgent)) || (ios && !/iPhone|iPod/.test(userAgent));
  const mobile = /Mobi|iPhone|iPod/.test(userAgent);
  const os = ios ? "ios" : /Android/.test(userAgent) ? "android" : /Windows/.test(userAgent) ? "windows" : /Macintosh|Mac OS X/.test(userAgent) ? "macos" : /Linux/.test(userAgent) ? "linux" : "other";
  const browser = /Edg(?:e|A|iOS)?\//.test(userAgent) ? "edge" : /Firefox|FxiOS/.test(userAgent) ? "firefox" : /Chrome|CriOS/.test(userAgent) ? "chrome" : /Safari/.test(userAgent) ? "safari" : "other";
  let source: ClientContext["source"] = referrer ? "unknown" : "none";
  if (referrer) {
    try {
      const url = new URL(referrer);
      if (url.protocol === "https:" || url.protocol === "http:") {
        const host = url.hostname;
        source = url.origin === origin ? "internal"
          : /(^|\.)(google\.[a-z.]+|bing\.com|baidu\.com|sogou\.com|duckduckgo\.com)$/.test(host) ? "search"
          : /(^|\.)(weibo\.com|zhihu\.com|bilibili\.com|twitter\.com|x\.com|facebook\.com|reddit\.com|t\.co)$/.test(host) ? "social" : "external";
      }
    } catch { /* Invalid referrers remain unknown. */ }
  }
  return { device: tablet ? "tablet" : mobile ? "mobile" : userAgent ? "desktop" : "unknown", browser, os, source };
}
