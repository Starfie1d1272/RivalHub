"use client";

import React from "react";
import { useState, useEffect } from "react";

interface DraftCountdownProps {
  deadline: string | null; // ISO string
  isActive: boolean;
}

export function DraftCountdown({ deadline, isActive }: DraftCountdownProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!deadline || !isActive) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [deadline, isActive]);

  if (!deadline) {
    return (
      <span className="text-sm text-[var(--text-muted)] tabular">
        --:--
      </span>
    );
  }

  if (!isActive) {
    const remaining = getCountdownSeconds(deadline, now);
    return (
      <span className="text-sm text-[var(--text-muted)] tabular">
        {formatTime(remaining)}
      </span>
    );
  }

  if (isDeadlinePassed(deadline, now)) {
    return (
      <span className="text-sm text-red-400 font-medium tabular">
        已超时
      </span>
    );
  }

  const remaining = getCountdownSeconds(deadline, now);
  const urgent = remaining < 30;

  return (
    <span
      className={`tabular text-sm font-medium ${
        urgent ? "text-red-400 animate-pulse" : "text-[var(--text-primary)]"
      }`}
    >
      {formatTime(remaining)}
    </span>
  );
}

function getCountdownSeconds(deadline: string, now: number): number {
  return Math.max(0, Math.floor((new Date(deadline).getTime() - now) / 1000));
}

function isDeadlinePassed(deadline: string, now: number): boolean {
  return new Date(deadline).getTime() <= now;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
