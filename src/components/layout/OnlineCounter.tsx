"use client";

import { useEffect, useState } from "react";
import { heartbeatOnline } from "@/actions/online";
import { deploymentUpdateRequired, reportDeploymentUpdate, subscribeDeploymentUpdate } from "@/lib/deployment-update";

export function OnlineCounter() {
  const [presence, setPresence] = useState<{ count: number; windowSeconds: number } | null>(null);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let intervalMs = 60_000;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (inFlight || deploymentUpdateRequired()) return;
      clearTimeout(timer);
      if (document.hidden) return;
      inFlight = true;
      try {
        const data = await heartbeatOnline();
        intervalMs = data.intervalMs;
        if (active) setPresence(data);
      } catch (error) {
        reportDeploymentUpdate(error);
        // A stale presence count is not a current online count.
        if (active) setPresence(null);
      } finally {
        inFlight = false;
        if (active && !deploymentUpdateRequired()) timer = setTimeout(() => { void tick(); }, intervalMs);
      }
    }
    const unsubscribe = subscribeDeploymentUpdate(() => clearTimeout(timer));
    void tick();
    document.addEventListener("visibilitychange", tick);
    return () => { clearTimeout(timer); unsubscribe(); active = false; document.removeEventListener("visibilitychange", tick); };
  }, []);

  if (presence === null) return null;

  return (
    <span title={`最近 ${presence.windowSeconds / 60} 分钟活跃的登录账号`} className="font-mono text-[11px] text-[var(--color-fg-mid)] select-none">
      <span style={{ color: "var(--color-accent)" }}>●</span>{" "}
      {presence.count.toLocaleString()}
    </span>
  );
}
