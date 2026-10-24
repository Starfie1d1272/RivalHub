"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useVisiblePolling } from "@/components/use-visible-polling";
import { readPublicMatchRefreshToken } from "@/actions/public-match-refresh";
import type { PublicMatchRefreshScope } from "@/lib/matches/public-refresh";

/** Live frames remain on Broadcast; idle pages read a token instead of rebuilding RSC. */
export function MatchContextRefresh({ enabled, seasonSlug, scope }: {
  enabled: boolean; seasonSlug: string; scope: PublicMatchRefreshScope;
}) {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  const lastFullSync = useRef(0);
  const lastObservedToken = useRef<string | null>(null);
  const requestScope = `${seasonSlug}:${scope.matchId ?? scope.stage}`;
  const currentScope = useRef(requestScope);
  useEffect(() => {
    currentScope.current = requestScope;
    lastFullSync.current = 0;
    lastObservedToken.current = null;
  }, [requestScope]);
  useVisiblePolling(async () => {
    if (pending) return;
    const requestedScope = requestScope;
    const result = await readPublicMatchRefreshToken({ seasonSlug, scope }).catch(() => null);
    if (currentScope.current !== requestedScope) return;
    const now = Date.now();
    if (lastFullSync.current === 0) lastFullSync.current = now;
    // A failed read cannot be interpreted as unchanged. Full resync recovers
    // authorization/visibility changes and auxiliary/global facts within two minutes.
    const changed = !result?.success || result.data !== lastObservedToken.current;
    if (result?.success) lastObservedToken.current = result.data;
    // The first read establishes a baseline before starting its RSC request.
    // Comparing against a later SSR fingerprint could miss a concurrent change.
    if (changed || now - lastFullSync.current >= 120_000) {
      lastFullSync.current = now;
      startRefresh(() => router.refresh());
    }
  }, enabled ? 15_000 : null);
  return null;
}
