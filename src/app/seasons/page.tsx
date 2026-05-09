export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";

export const metadata: Metadata = { title: "所有赛季" };

export default async function SeasonsPage() {
  const allSeasons = await db
    .select()
    .from(seasons)
    .orderBy(desc(seasons.createdAt));

  return (
    <div className="container mx-auto px-4 py-12 sm:py-16">
      <div className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-2">所有赛季</h1>
        <p className="text-[var(--text-secondary)]">
          共 <span className="tabular text-[var(--text-primary)]">{allSeasons.length}</span> 个赛季归档
        </p>
      </div>

      {allSeasons.length === 0 ? (
        <p className="text-[var(--text-muted)] text-center py-16">暂无赛季记录</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allSeasons.map((season) => (
            <Link
              key={season.id}
              href={`/${season.slug}` as never}
              className="card-elevated block rounded-lg border border-[var(--border)] overflow-hidden"
            >
              <div className="h-1 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <StatusDot status={season.status} />
                  <span className="text-[var(--text-secondary)]">
                    {SEASON_STATUS_LABELS[season.status]}
                  </span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[var(--text-muted)]">{season.kind}</span>
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{season.name}</h3>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
