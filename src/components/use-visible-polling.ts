"use client";

import { useEffect, useEffectEvent, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Poll only visible pages, with at most one asynchronous read in flight. */
export function useVisiblePolling(poll: () => void | Promise<void>, intervalMs: number | null) {
  const inFlight = useRef(false);
  const runPoll = useEffectEvent(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      await poll();
    } finally {
      inFlight.current = false;
    }
  });

  useEffect(() => {
    if (intervalMs === null) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const resume = () => {
      stop();
      if (document.visibilityState === "hidden") return;
      timer = setInterval(() => void runPoll(), intervalMs);
    };
    const onVisibility = () => {
      resume();
      if (document.visibilityState !== "hidden") void runPoll();
    };
    resume();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
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
