import React from "react";
import Link from "next/link";
import type { SeasonStatus } from "@/types/season";
import { Marker, Panel, StatusPill } from "@/components/rivalhub";

interface SeasonCard {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: SeasonStatus;
}

interface SeasonCardGridProps {
  markerNum: number;
  markerSub: string;
  title: string;
  seasons: SeasonCard[];
}

export function SeasonCardGrid({
  markerNum,
  markerSub,
  title,
  seasons,
}: SeasonCardGridProps) {
  if (seasons.length === 0) {
    return null;
  }

  return (
    <div>
      <Marker num={markerNum} sub={markerSub}>
        {title}
      </Marker>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {seasons.map((season) => (
          <Link key={season.id} href={`/${season.slug}` as never}>
            <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
              <div className="flex items-center gap-2 mb-2">
                <StatusPill status={season.status} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-fg-dim)",
                  }}
                >
                  {season.kind}
                </span>
              </div>
              <div
                className="font-semibold"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 16,
                  color: "var(--color-fg)",
                }}
              >
                {season.name}
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
