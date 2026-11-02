import type { PublicRuntimeConfig } from "@/lib/runtime/public-config";
import { browserViewerEnvironment, connectLiveViewer, type ViewerEnvironment } from "./live-viewer";
import { initialLiveViewerState, type LiveViewerState } from "./live-viewer-state";

// Keep a still-running receiver briefly across navigation/Strict Mode remounts.
// This is not a saved baseline: a stopped receiver is removed, never replayed.
const IDLE_DISCONNECT_MS = 5000;

export function createLiveViewerSubscriptions(environment: ViewerEnvironment) {
  const entries = new Map<string, {
    state: LiveViewerState;
    listeners: Set<(state: LiveViewerState) => void>;
    stop: () => void;
    idleTimer?: ReturnType<typeof setTimeout>;
  }>();
  return (matchId: string, onState: (state: LiveViewerState) => void): (() => void) => {
    let entry = entries.get(matchId);
    if (!entry) {
      entry = { state: initialLiveViewerState(), listeners: new Set(), stop: () => {} };
      entries.set(matchId, entry);
      const receiver = entry;
      receiver.stop = connectLiveViewer(matchId, state => {
        receiver.state = state;
        for (const listener of receiver.listeners) listener(state);
      }, environment);
    }
    const receiver = entry;
    clearTimeout(receiver.idleTimer);
    const listener = (state: LiveViewerState) => onState(state);
    receiver.listeners.add(listener);
    // Retain the original monotonic receipt time. Re-entry cannot refresh age.
    onState(receiver.state);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      receiver.listeners.delete(listener);
      if (receiver.listeners.size === 0) {
        receiver.idleTimer = setTimeout(() => {
          entries.delete(matchId);
          receiver.stop();
        }, IDLE_DISCONNECT_MS);
      }
    };
  };
}

// Browser module memory only. The separate, verified previous-view store never
// restores a JWT, Auth identity or live watermark into this receiver.
// All consumers receive the same anonymous, single-match public projection; this
// client never holds a signed-in user's Supabase Auth identity or operator data.
const browserSubscriptions = new Map<string, ReturnType<typeof createLiveViewerSubscriptions>>();
export function subscribeBrowserLiveViewer(config: PublicRuntimeConfig, matchId: string, onState: (state: LiveViewerState) => void) {
  const identity = JSON.stringify([config.supabaseUrl, config.supabasePublishableKey]);
  let subscribe = browserSubscriptions.get(identity);
  if (!subscribe) {
    subscribe = createLiveViewerSubscriptions(browserViewerEnvironment(config));
    browserSubscriptions.set(identity, subscribe);
  }
  return subscribe(matchId, onState);
}
