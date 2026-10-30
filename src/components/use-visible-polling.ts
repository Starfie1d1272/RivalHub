"use client";

import { useEffect, useEffectEvent, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deploymentUpdateRequired, subscribeDeploymentUpdate } from "@/lib/deployment-update";

/** Poll only visible pages, with at most one asynchronous read in flight. */
export function useGuardedVisiblePolling(poll: (isCurrent: () => boolean) => void | Promise<void>, intervalMs: number | null, identityKey?: string, pauseOnDeploymentUpdate = false) {
  const inFlight = useRef(false);
  const generation = useRef(0);
  const recheckAfterFlight = useRef(false);
  const runPoll = useEffectEvent(async (recheck = false) => {
    if (intervalMs === null || document.visibilityState === "hidden" || (pauseOnDeploymentUpdate && deploymentUpdateRequired())) return;
    if (inFlight.current) {
      if (recheck) recheckAfterFlight.current = true;
      return;
    }
    const startedGeneration = generation.current;
    const isCurrent = () => generation.current === startedGeneration && document.visibilityState !== "hidden" && (!pauseOnDeploymentUpdate || !deploymentUpdateRequired());
    inFlight.current = true;
    try {
      await poll(isCurrent);
    } finally {
      inFlight.current = false;
      if (recheckAfterFlight.current) {
        recheckAfterFlight.current = false;
        void runPoll();
      }
    }
  });

  useEffect(() => {
    generation.current += 1;
    recheckAfterFlight.current = false;
    if (intervalMs === null) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const resume = () => {
      stop();
      if (document.visibilityState === "hidden" || (pauseOnDeploymentUpdate && deploymentUpdateRequired())) return;
      timer = setInterval(() => void runPoll(), intervalMs);
    };
    const onVisibility = () => {
      generation.current += 1;
      recheckAfterFlight.current = false;
      resume();
      if (document.visibilityState !== "hidden") void runPoll(true);
    };
    const unsubscribe = pauseOnDeploymentUpdate ? subscribeDeploymentUpdate(stop) : () => {};
    resume();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      generation.current += 1;
      recheckAfterFlight.current = false;
      stop();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, identityKey, pauseOnDeploymentUpdate]);
}

/** Keep the legacy zero-argument callback contract (some callbacks accept an optional UI flag). */
export function useVisiblePolling(poll: () => void | Promise<void>, intervalMs: number | null) {
  useGuardedVisiblePolling(() => poll(), intervalMs);
}

/** router.refresh is void; its React transition owns the pending RSC request. */
export function useRoutePolling(intervalMs: number | null, mutationPending = false) {
  const router = useRouter();
  const [refreshPending, startRefresh] = useTransition();
  const refresh = () => {
    if (!refreshPending && !mutationPending) startRefresh(() => router.refresh());
  };
  useVisiblePolling(refresh, intervalMs);
  return { refresh, refreshPending };
}
