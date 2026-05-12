export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { Panel, Marker, StatusPill } from "@/components/rivalhub";

export const metadata: Metadata = { title: "所有赛季" };

export default async function SeasonsPage() {
  const allSeasons = await db
    .select()
    .from(seasons)
    .orderBy(desc(seasons.createdAt));

  return (
    <div className="container mx-auto px-4 py-12 sm:py-16">
      <div className="mb-10">
        <Marker sub={`共 ${allSeasons.length} 个赛季归档`}>所有赛季</Marker>
      </div>

      {allSeasons.length === 0 ? (
        <p className="text-[var(--color-fg-dim)] text-center py-16">暂无赛季记录</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allSeasons.map((season) => (
            <Link
              key={season.id}
              href={`/${season.slug}` as never}
            >
              <Panel className="hover:border-[var(--color-border-hi)] transition-colors" pad={0}>
                <div className="h-1 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3 text-xs">
                    <StatusPill status={season.status} />
                    <span className="text-[var(--color-fg-mid)]">
                      {SEASON_STATUS_LABELS[season.status]}
                    </span>
                    <span className="text-[var(--color-fg-dim)]">·</span>
                    <span className="text-[var(--color-fg-dim)]">{season.kind}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--color-fg)] mb-1">{season.name}</h3>
                </div>
              </Panel>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
