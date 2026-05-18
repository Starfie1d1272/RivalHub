"use client";

import { useEffect, useState, useCallback } from "react";
import { touchSession } from "@/actions/online";

export function OnlineCounter() {
  const [count, setCount] = useState<number | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/online-count", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCount(data.count);
      }
    } catch {
      // API 不可用时静默跳过
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const tick = () => {
      touchSession()
        .then(() => { if (mounted) fetchCount(); })
        .catch(() => {}); // user_sessions 表不存在时静默跳过
    };
    tick();
    const id = setInterval(tick, 300_000); // 每 5 分钟心跳
    return () => { clearInterval(id); mounted = false; };
  }, [fetchCount]);

  if (count === null) return null;

  return (
    <span className="font-mono text-[11px] text-[var(--color-fg-mid)] select-none">
      <span style={{ color: "var(--color-accent)" }}>●</span>{" "}
      {count.toLocaleString()}
    </span>
  );
}
