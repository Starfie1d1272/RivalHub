"use client";

import { useEffect, useState, useCallback } from "react";
import { touchSession } from "@/actions/online";

export function OnlineCounter() {
  const [count, setCount] = useState<number | null>(null);

  const fetchCount = useCallback(async () => {
    const res = await fetch("/api/online-count", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setCount(data.count);
    }
  }, []);

  useEffect(() => {
    touchSession().then(() => fetchCount());
    const id = setInterval(() => {
      touchSession().then(() => fetchCount());
    }, 120_000); // 每 2 分钟心跳
    return () => clearInterval(id);
  }, [fetchCount]);

  if (count === null) return null;

  return (
    <span className="text-xs text-[var(--color-fg-dim)]">
      {count} 人在线
    </span>
  );
}
