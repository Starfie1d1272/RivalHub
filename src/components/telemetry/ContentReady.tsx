"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureTelemetryNavigation, recordContentReady } from "@/lib/telemetry/client";
import type { READY_MODULES, READY_PHASES } from "@/lib/telemetry/protocol";

/** Mount beside actual usable content, never in its Suspense fallback. */
export function ContentReady({ module, phase = "primary" }: {
  module: typeof READY_MODULES[number]; phase?: typeof READY_PHASES[number];
}) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.location.pathname === pathname && new URLSearchParams(window.location.search).toString() === search) recordContentReady(captureTelemetryNavigation(), module, phase);
    }, 0);
    return () => clearTimeout(timer);
  }, [module, phase, pathname, search]);
  return null;
}
