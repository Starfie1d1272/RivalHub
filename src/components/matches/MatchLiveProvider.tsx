"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { usePublicRuntimeConfig } from "@/components/layout/PublicRuntimeConfig";
import { subscribeBrowserLiveViewer } from "@/lib/mizar/live-viewer-subscriptions";
import { initialLiveViewerState } from "@/lib/mizar/live-viewer-state";
import { browserPreviousLiveViewStore } from "@/lib/mizar/live-previous-view";

const empty = { state: initialLiveViewerState(), now: 0 };
const MatchLiveContext = createContext(empty);
export function MatchLiveProvider({ matchId, enabled = true, eligible = true, children }: { matchId: string; enabled?: boolean; eligible?: boolean; children: React.ReactNode }) {
  return <Connection key={`${matchId}:${enabled}:${eligible}`} matchId={matchId} enabled={enabled && eligible} eligible={eligible}>{children}</Connection>;
}
function Connection({ matchId, enabled, eligible, children }: { matchId: string; enabled: boolean; eligible: boolean; children: React.ReactNode }) {
  const config = usePublicRuntimeConfig();
  const [state, setState] = useState(initialLiveViewerState);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!eligible) browserPreviousLiveViewStore(config.supabaseUrl)?.clear(matchId);
    if (!enabled) return;
    return subscribeBrowserLiveViewer(config, matchId, state => {
      setState(state);
      setNow(performance.now());
    });
  }, [matchId, enabled, eligible, config]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [enabled]);
  return <MatchLiveContext.Provider value={enabled ? { state, now } : empty}>{children}</MatchLiveContext.Provider>;
}
export function useMatchLive() { return useContext(MatchLiveContext); }
