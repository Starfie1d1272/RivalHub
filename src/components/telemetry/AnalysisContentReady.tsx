"use client";

import { useEffect, useState } from "react";
import { ContentReady } from "./ContentReady";

/** Server content is visible before controls hydrate; expose the test marker after commit. */
export function AnalysisContentReady({ view }: { view: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <><ContentReady module="admin" phase="primary" /><span hidden data-testid={ready ? "telemetry-content-ready" : undefined} data-view={view} /></>;
}
