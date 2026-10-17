import React from "react";
import Link from "next/link";
import type { HomeNavEntry } from "@/lib/home/navigation";
import { Marker } from "@/components/rivalhub";

interface HomeNavigationProps {
  tier1Entry: HomeNavEntry | null;
  tier2Entries: HomeNavEntry[];
  tier3Entries: HomeNavEntry[];
}

export function HomeNavigation({ tier1Entry, tier2Entries, tier3Entries }: HomeNavigationProps) {
  const featured = tier2Entries.filter(entry => entry.key !== tier1Entry?.key);
  return <section className="space-y-5"><Marker num={1} sub="EXPLORE">赛事与互动</Marker>
    <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{featured.map(entry => <Link key={entry.key} href={entry.href as never} className="group flex min-h-24 items-center justify-between gap-3 border-t border-[var(--color-border)] py-5"><div><p className="mb-2 font-mono text-xs tracking-widest text-[var(--color-fg-mid)]">{entry.mono}</p><h2 className="text-xl font-semibold group-hover:text-[var(--color-accent)]">{entry.label}</h2>{entry.meta && <p className="mt-1 text-sm text-[var(--color-fg-mid)]">{entry.meta}</p>}</div><span aria-hidden className="text-[var(--color-accent)]">↗</span></Link>)}</div>
    <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-[var(--color-border)] pt-4">{tier3Entries.map(entry => <Link key={entry.key} href={entry.href as never} className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]">{entry.label} →</Link>)}</div>
  </section>;
}
