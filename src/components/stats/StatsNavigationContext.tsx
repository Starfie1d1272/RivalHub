"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeStatsReturn } from "@/lib/stats/return-context";

const StatsNavigationContext = createContext<string | null>(null);
export function StatsNavigationProvider({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const from = safeStatsReturn(`/stats?${search}`);
  return <StatsNavigationContext.Provider value={from}>{children}</StatsNavigationContext.Provider>;
}
export function useStatsProfileHref(href: string) {
  const from = useContext(StatsNavigationContext);
  return from && href.startsWith("/") ? `${href}${href.includes("?") ? "&" : "?"}fromStats=${encodeURIComponent(from)}` : href;
}
export function StatsReturnLink() {
  const search = useSearchParams();
  const from = safeStatsReturn(search.get("fromStats"));
  return from ? <Link href={from as import("next").Route} className="inline-flex py-2 text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">← 返回筛选后的统计</Link> : null;
}
