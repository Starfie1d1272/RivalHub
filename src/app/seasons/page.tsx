import Link from "next/link";
import type { Metadata } from "next";
import { SEASON_STATUS_LABELS } from "@/types/season";
import type { SeasonStatus } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";

export const metadata: Metadata = { title: "历史赛季" };

// Mock data — replaced with DB query in Phase 4+
const seasons: Array<{
  slug: string;
  name: string;
  kind: string;
  status: SeasonStatus;
  themeColor: string;
  schedule: string;
}> = [
  { slug: "2026-nju-rivals", name: "2026 NJU Rivals", kind: "选秀联赛", status: "registration", themeColor: "#f97316", schedule: "2026 年春季" },
];

export default function SeasonsPage() {
  return (
    <div className="container mx-auto px-4 py-12 sm:py-16">
      <div className="mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-2">所有赛季</h1>
        <p className="text-[var(--text-secondary)]">
          共 <span className="tabular text-[var(--text-primary)]">{seasons.length}</span> 个赛季归档
        </p>
      </div>

      {seasons.length === 0 ? (
        <p className="text-[var(--text-muted)] text-center py-16">暂无赛季记录</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {seasons.map((season) => {
            return (
              <Link
                key={season.slug}
                href={`/${season.slug}` as never}
                className="card-elevated block rounded-lg border border-[var(--border)] overflow-hidden"
              >
                <div className="h-1 w-full" style={{ backgroundColor: season.themeColor }} />
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3 text-xs">
                    <StatusDot status={season.status} />
                    <span className="text-[var(--text-secondary)]">{SEASON_STATUS_LABELS[season.status]}</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="text-[var(--text-muted)]">{season.kind}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{season.name}</h3>
                  <p className="text-xs text-[var(--text-muted)] tabular">{season.schedule}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
