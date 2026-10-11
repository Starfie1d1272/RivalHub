// Kept independent of the LIVE parser so Auth UI does not load the wire schema.
export const LIVE_VIEW_CACHE_KEY_PREFIX = "rivalhub:previous-live:v1:";
export const LIVE_VIEW_CACHE_RESET_EVENT = "rivalhub:previous-live:reset";

export function clearPreviousLiveViews() {
  try {
    const storage = window.sessionStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(LIVE_VIEW_CACHE_KEY_PREFIX)) storage.removeItem(key);
    }
  } catch {}
  window.dispatchEvent(new Event(LIVE_VIEW_CACHE_RESET_EVENT));
}
