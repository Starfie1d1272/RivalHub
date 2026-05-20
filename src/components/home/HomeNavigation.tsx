import React from "react";
import Link from "next/link";
import type { HomeNavEntry } from "@/lib/home/navigation";
import { Btn, Marker, Panel } from "@/components/rivalhub";

interface HomeNavigationProps {
  tier1Entry: HomeNavEntry | null;
  tier2Entries: HomeNavEntry[];
  tier3Entries: HomeNavEntry[];
}

export function HomeNavigation({
  tier1Entry,
  tier2Entries,
  tier3Entries,
}: HomeNavigationProps) {
  return (
    <div>
      <Marker num={1} sub="NAVIGATION">
        入口
      </Marker>

      {tier1Entry && (
        <div className="mb-3">
          <Link href={tier1Entry.href as never} className="group block">
            <Panel className="transition-colors hover:border-[var(--color-border-hi)] border-l-[3px] border-l-[var(--color-accent)]">
              <div className="flex items-center justify-between">
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--color-fg-dim)",
                      letterSpacing: "var(--tracking-label)",
                      marginBottom: 4,
                    }}
                  >
                    {tier1Entry.mono}
                  </div>
                  <div
                    className="font-semibold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 18,
                      color: "var(--color-fg)",
                    }}
                  >
                    {tier1Entry.label}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 20,
                    color: "var(--color-accent)",
                  }}
                >
                  →
                </span>
              </div>
            </Panel>
          </Link>
        </div>
      )}

      {tier2Entries.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          {tier2Entries.map((tile) => (
            <Link key={tile.href} href={tile.href as never} className="group">
              <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
                <div
                  className="flex items-center gap-2 mb-1.5"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-fg-dim)",
                    letterSpacing: "var(--tracking-label)",
                  }}
                >
                  {tile.mono}
                </div>
                <div
                  className="font-semibold"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 14,
                    color: "var(--color-fg)",
                  }}
                >
                  {tile.label}
                </div>
              </Panel>
            </Link>
          ))}
        </div>
      )}

      {tier3Entries.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {tier3Entries.map((tile) => (
            <Btn key={tile.href} ghost asChild>
              <Link href={tile.href as never}>{tile.label}</Link>
            </Btn>
          ))}
        </div>
      )}
    </div>
  );
}
