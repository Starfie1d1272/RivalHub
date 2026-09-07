"use client";

import { useEffect, useState } from "react";
import { getCountdownSeconds } from "@/lib/utils/date";

function formatCountdown(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `还有 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `还有 ${hours} 小时 ${minutes} 分钟`;
  return `还有 ${minutes} 分钟`;
}

/** A low-frequency hint only; the server-owned registration window remains
 * authoritative for whether a visitor can actually submit. */
export function RegistrationScheduleCountdown({ target }: { target: string | null }) {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const update = () => setSeconds(getCountdownSeconds(target));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!target || seconds === null || seconds <= 0) return null;
  return (
    <span className="font-mono tabular-nums text-xs text-[var(--color-fg-mid)]" aria-live="polite">
      {formatCountdown(seconds)}
    </span>
  );
}
