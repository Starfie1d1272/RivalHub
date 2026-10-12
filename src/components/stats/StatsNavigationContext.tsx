"use client";
import { createContext, useContext, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeStatsReturn } from "@/lib/stats/return-context";

const StatsNavigationContext = createContext<string | null>(null);
export function StatsNavigationProvider({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const from = pathname === "/stats" ? safeStatsReturn(`/stats?${search}`) : null;
  return <StatsNavigationContext.Provider value={from}>{children}</StatsNavigationContext.Provider>;
}
export function useStatsProfileHref(href: string) {
  const from = useContext(StatsNavigationContext);
  if (!from || !href.startsWith("/")) return href;
  const destination = new URL(href, "https://rivalhub.invalid");
  const source = new URL(from, "https://rivalhub.invalid");
  if (destination.pathname.startsWith("/players/")) {
    const event = source.searchParams.get("event");
    const map = source.searchParams.get("mapFilter");
    if (event) destination.searchParams.set("event", event);
    if (map && /^de_[a-z0-9_]+$/.test(map)) destination.searchParams.set("map", map);
  }
  destination.searchParams.set("fromStats", from);
  return `${destination.pathname}?${destination.searchParams}`;
}
export function StatsReturnLink({ href }: { href?: string | null }) {
  const from = safeStatsReturn(href);
  return from ? <Link href={from as import("next").Route} className="inline-flex py-2 text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">← 返回筛选后的统计</Link> : null;
}
