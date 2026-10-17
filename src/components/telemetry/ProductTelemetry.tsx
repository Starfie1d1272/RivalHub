"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Bootstrap } from "@/lib/telemetry/protocol";
import { configureTelemetry, flushTelemetry, markHistoryNavigation, recordClientError, recordPage, renewTelemetryIfNeeded, setTelemetryScene, telemetryFlushInterval } from "@/lib/telemetry/client";

export function ProductTelemetry({ config }: { config: Bootstrap | null }) {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    configureTelemetry(config);
    if (!config) return;
    const renew = () => { void renewTelemetryIfNeeded(); };
    const timer = setInterval(() => { flushTelemetry(); renew(); }, telemetryFlushInterval);
    const hidden = () => { if (document.visibilityState === "hidden") flushTelemetry(); else renew(); };
    renew();
    window.addEventListener("popstate", markHistoryNavigation);
    window.addEventListener("pagehide", flushTelemetry);
    window.addEventListener("error", recordClientError);
    window.addEventListener("unhandledrejection", recordClientError);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener("popstate", markHistoryNavigation);
      window.removeEventListener("pagehide", flushTelemetry);
      window.removeEventListener("error", recordClientError);
      window.removeEventListener("unhandledrejection", recordClientError);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [config]);
  useEffect(() => {
    // Layout scene effects settle first; no DOM scanning, click stream, or input listeners.
    const timer = setTimeout(recordPage, 0);
    return () => clearTimeout(timer);
  }, [config, pathname, search]);
  return null;
}

export function TelemetryScene({ prefix, scene, eventId }: { prefix: string; scene: string; eventId: string }) {
  useEffect(() => { setTelemetryScene(prefix, scene, eventId); }, [prefix, scene, eventId]);
  return null;
}
