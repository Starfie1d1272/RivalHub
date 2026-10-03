import { requireSupabasePublicKey } from "@/lib/runtime/supabase-keys";
import { createLiveViewerClient } from "@/lib/auth/supabase";
import { initialLiveViewerState, receivePublicLive, resetLiveViewer, type LiveViewerState } from "./live-viewer-state";

export interface ViewerEnvironment {
  url: string;
  key: string;
  fetch: typeof fetch;
  createClient: typeof createLiveViewerClient;
  now: () => number;
  visible: () => boolean;
  onResume: (callback: () => void) => () => void;
}

/** One disposable receive-only client per mounted Match. Never shares the Auth client. */
export function connectLiveViewer(matchId: string, onState: (state: LiveViewerState) => void, environment: ViewerEnvironment): () => void {
  let state = initialLiveViewerState();
  let stopped = false;
  let generation = 0;
  let client: ReturnType<typeof createLiveViewerClient> | null = null;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retry = 1000;
  const clear = () => {
    generation++;
    clearTimeout(timer);
    request?.abort();
    request = null;
    const old = client;
    client = null;
    if (old) { void old.removeAllChannels(); old.realtime.disconnect(); }
  };
  const reset = () => { state = resetLiveViewer(state); onState(state); };
  const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(() => { void join(); }, delay); };
  async function join() {
    clear();
    if (stopped || !environment.visible() || !environment.url || !environment.key) return;
    reset();
    const current = generation;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await environment.fetch(`/api/matches/${encodeURIComponent(matchId)}/live-viewer`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("viewer_unavailable");
      const data: unknown = await response.json();
      if (stopped || current !== generation) return;
      if (!data || typeof data !== "object" || !("token" in data) || typeof data.token !== "string" || !("topic" in data) || typeof data.topic !== "string" || !("expiresAt" in data) || typeof data.expiresAt !== "number") throw new Error("invalid_viewer");
      const { token, topic, expiresAt } = data;
      const ttl = expiresAt - Date.now();
      if (ttl <= 0 || ttl > 330000) throw new Error("expired_viewer");
      client = environment.createClient(environment.url, environment.key, async () => token);
      await client.realtime.setAuth(token);
      if (stopped || current !== generation) return;
      // Arm before subscribe: even synchronous readiness must replace this deadline.
      schedule(15000);
      client.channel(topic, { config: { private: true, broadcast: { self: false } } })
        .on("broadcast", { event: "snapshot" }, ({ payload }: { payload: unknown }) => {
          if (stopped || current !== generation || !environment.visible()) return;
          const next = receivePublicLive(state, payload, matchId, environment.now());
          if (next !== state) { state = next; onState(state); }
        })
        .subscribe((status) => {
          if (stopped || current !== generation) return;
          if (status === "SUBSCRIBED") { retry = 1000; schedule(Math.max(1000, ttl - 30000)); }
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { clear(); reset(); schedule(retry); retry = Math.min(retry * 2, 30000); }
        });

    } catch {
      if (!stopped && current === generation) { schedule(retry); retry = Math.min(retry * 2, 30000); }
    } finally { clearTimeout(timeout); }
  }
  const unsubscribe = environment.onResume(() => { clear(); reset(); if (environment.visible()) void join(); });
  void join();
  return () => { stopped = true; clear(); unsubscribe(); };
}

export function browserViewerEnvironment(): ViewerEnvironment {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? requireSupabasePublicKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) : "",
    fetch: window.fetch.bind(window), createClient: createLiveViewerClient, now: () => performance.now(),
    visible: () => document.visibilityState !== "hidden" && navigator.onLine,
    onResume(callback) {
      document.addEventListener("visibilitychange", callback);
      window.addEventListener("online", callback);
      window.addEventListener("offline", callback);
      window.addEventListener("pageshow", callback);
      return () => {
        document.removeEventListener("visibilitychange", callback);
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
        window.removeEventListener("pageshow", callback);
      };
    },
  };
}
