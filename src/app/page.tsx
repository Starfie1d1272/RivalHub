export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { APP_BRAND } from "@/lib/branding";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { StatusDot } from "@/components/ui/status-dot";
import type { Season } from "@/db/schema/seasons";

export default async function HomePage() {
  const allSeasons = await db
    .select()
    .from(seasons)
    .orderBy(seasons.createdAt);

  const activeSeasons = allSeasons.filter(
    (s) => s.status !== "archived" && s.status !== "draft"
  );
  const featured = activeSeasons[0];
  const others = activeSeasons.slice(1);

  return (
    <div className="container mx-auto px-4 py-16 sm:py-24">
      {/* Hero */}
      <div className="max-w-3xl mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/50 text-xs text-[var(--text-secondary)]">
          <span>开源 · 多赛事 · 数据驱动</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-primary)] mb-4 leading-tight">
          {APP_BRAND.name}
          <span className="block text-[var(--text-secondary)] text-2xl sm:text-3xl font-medium mt-2">
            电竞社群赛事管理平台
          </span>
        </h1>
        <p className="text-[var(--text-secondary)] text-base sm:text-lg max-w-xl leading-relaxed">
          {APP_BRAND.description}
        </p>
      </div>

      {featured ? (
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">当前赛季</h2>
            <span className="text-sm text-[var(--text-muted)] tabular">
              共 {activeSeasons.length} 个进行中
            </span>
          </div>
          <FeaturedSeasonCard season={featured} />
          {others.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {others.map((s) => (
                <CompactSeasonCard key={s.id} season={s} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="text-center text-[var(--text-secondary)] py-16">
          <p className="text-lg mb-2">暂无进行中的赛季</p>
          <Link href="/seasons" className="text-sm underline hover:text-[var(--text-primary)]">
            查看历史赛季
          </Link>
        </div>
      )}
    </div>
  );
}

function FeaturedSeasonCard({ season }: { season: Season }) {
  return (
    <Link
      href={`/${season.slug}` as never}
      className="group block card-elevated rounded-xl border border-[var(--border)] overflow-hidden"
    >
      <div className="h-1 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
      <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <div className="flex items-center gap-2 mb-3 text-xs">
            <StatusDot status={season.status} />
            <span className="text-[var(--text-secondary)] uppercase tracking-wider">
              {SEASON_STATUS_LABELS[season.status]}
            </span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">{season.kind}</span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] mb-2">
            {season.name}
          </h3>
        </div>
        <div
          className="hidden sm:flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-[var(--text-primary)] border transition-colors"
          style={{
            backgroundColor: `${season.themeColor ?? "#f97316"}1a`,
            borderColor: `${season.themeColor ?? "#f97316"}40`,
          }}
        >
          进入赛季
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

function CompactSeasonCard({ season }: { season: Season }) {
  return (
    <Link
      href={`/${season.slug}` as never}
      className="block card-elevated rounded-lg border border-[var(--border)] overflow-hidden"
    >
      <div className="h-0.5 w-full" style={{ backgroundColor: season.themeColor ?? "#f97316" }} />
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2 text-xs">
          <StatusDot status={season.status} />
          <span className="text-[var(--text-secondary)]">
            {SEASON_STATUS_LABELS[season.status]}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{season.name}</h3>
        <p className="text-sm text-[var(--text-muted)]">{season.kind}</p>
      </div>
    </Link>
  );
}
