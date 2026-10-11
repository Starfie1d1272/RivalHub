"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { subscribeBrowserLiveViewer } from "@/lib/mizar/live-viewer-subscriptions";
import { initialLiveViewerState } from "@/lib/mizar/live-viewer-state";
import { browserPreviousLiveViewStore } from "@/lib/mizar/live-previous-view";

const empty = { state: initialLiveViewerState(), now: 0 };
const MatchLiveContext = createContext(empty);
export function MatchLiveProvider({ matchId, enabled = true, children }: { matchId: string; enabled?: boolean; children: React.ReactNode }) {
  return <Connection key={`${matchId}:${enabled}`} matchId={matchId} enabled={enabled}>{children}</Connection>;
}
function Connection({ matchId, enabled, children }: { matchId: string; enabled: boolean; children: React.ReactNode }) {
  const [state, setState] = useState(initialLiveViewerState);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) { browserPreviousLiveViewStore()?.clear(matchId); return; }
    return subscribeBrowserLiveViewer(matchId, state => {
      setState(state);
      setNow(performance.now());
    });
  }, [matchId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [enabled]);
  return <MatchLiveContext.Provider value={enabled ? { state, now } : empty}>{children}</MatchLiveContext.Provider>;
}
export function useMatchLive() { return useContext(MatchLiveContext); }
