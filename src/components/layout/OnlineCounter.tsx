"use client";

import { useEffect, useState } from "react";
import { touchSession, getOnlineCount } from "@/actions/online";

export function OnlineCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function tick() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        await touchSession();
        const data = await getOnlineCount();
        if (active) setCount(data.count);
      } catch {
        // A stale presence count is not a current online count.
        if (active) setCount(null);
      } finally {
        inFlight = false;
      }
    }
    void tick();
    const id = setInterval(() => { void tick(); }, 300_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); active = false; document.removeEventListener("visibilitychange", tick); };
  }, []);

  if (count === null) return null;

  return (
    <span className="font-mono text-[11px] text-[var(--color-fg-mid)] select-none">
      <span style={{ color: "var(--color-accent)" }}>●</span>{" "}
      {count.toLocaleString()}
    </span>
  );
}
