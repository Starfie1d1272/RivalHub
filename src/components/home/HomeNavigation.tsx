import Link from "next/link";
import type { HomeNavEntry } from "@/lib/home/navigation";
import { Marker } from "@/components/rivalhub";

interface HomeNavigationProps {
  tier1Entry: HomeNavEntry | null;
  tier2Entries: HomeNavEntry[];
  tier3Entries: HomeNavEntry[];
}

export function HomeNavigation({ tier1Entry, tier2Entries, tier3Entries }: HomeNavigationProps) {
  const related = tier2Entries.filter((entry) => entry.key !== tier1Entry?.key);
  const featured = related.slice(0, 4);
  const secondary = [...related.slice(4), ...tier3Entries];

  return (
    <section className="space-y-4">
      <Marker num={1} sub="EXPLORE"><h2>赛事与互动</h2></Marker>
      {featured.length > 0 && (
        <div className={`grid gap-x-8 sm:grid-cols-2 ${featured.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {featured.map((entry) => (
            <Link key={entry.key} href={entry.href as never} className="group flex min-w-0 items-center justify-between gap-4 border-t border-[var(--color-border)] py-4">
              <div className="min-w-0">
                <p className="mb-2 font-mono text-[11px] tracking-widest text-[var(--color-fg-dim)]">{entry.mono}</p>
                <h3 className="text-xl font-semibold transition-colors group-hover:text-[var(--color-accent)]">{entry.label}</h3>
                {entry.meta && <p className="mt-1 text-sm text-[var(--color-fg-mid)]">{entry.meta}</p>}
              </div>
              <span aria-hidden="true" className="text-lg text-[var(--color-accent)]">↗</span>
            </Link>
          ))}
        </div>
      )}
      {secondary.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--color-border)] pt-3">
          {secondary.map((entry) => <Link key={entry.key} href={entry.href as never} className="inline-flex min-h-8 items-center text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]">{entry.label} →</Link>)}
        </div>
      )}
    </section>
  );
}
