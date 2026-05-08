import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { APP_BRAND } from "@/lib/branding";

type SeasonStatus = "registration" | "voting" | "drafting" | "playing" | "finished" | "upcoming";

const STATUS_CONFIG: Record<SeasonStatus, { label: string; tone: "live" | "soon" | "done" }> = {
  registration: { label: "报名中",   tone: "live" },
  voting:       { label: "投票中",   tone: "live" },
  drafting:     { label: "选秀中",   tone: "live" },
  playing:      { label: "进行中",   tone: "live" },
  finished:     { label: "已结束",   tone: "done" },
  upcoming:     { label: "敬请期待", tone: "soon" },
};

// Mock data — replaced with DB query in Phase 4+
const seasons: Array<{
  slug: string;
  name: string;
  kind: string;
  status: SeasonStatus;
  themeColor: string;
  description: string;
  schedule: string;
}> = [
  {
    slug: "2026-nju-rivals",
    name: "2026 NJU Rivals",
    kind: "选秀联赛",
    status: "registration",
    themeColor: "#f97316",
    description: "南京大学 CS2 社群选秀联赛，56 选手 · 8 队伍 · 双败淘汰。",
    schedule: "2026 年春季",
  },
];

function StatusDot({ tone }: { tone: "live" | "soon" | "done" }) {
  const colorMap = {
    live: "bg-emerald-400",
    soon: "bg-amber-400",
    done: "bg-zinc-500",
  };
  return (
    <span className="relative flex h-2 w-2">
      {tone === "live" && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colorMap[tone]} opacity-60`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colorMap[tone]}`} />
    </span>
  );
}

export default function HomePage() {
  const activeSeasons = seasons.filter((s) => s.status !== "finished");
  const featured = activeSeasons[0];
  const others = activeSeasons.slice(1);

  return (
    <div className="container mx-auto px-4 py-16 sm:py-24">
      {/* Hero */}
      <div className="max-w-3xl mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/50 text-xs text-[var(--text-secondary)]">
          <Trophy size={12} className="text-amber-400" />
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

      {/* Active seasons */}
      {featured ? (
        <section>
          <div className="flex items-baseline justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">当前赛季</h2>
            <span className="text-sm text-[var(--text-muted)] tabular">
              共 {activeSeasons.length} 个进行中
            </span>
          </div>

          {/* Featured card (large) */}
          <FeaturedSeasonCard season={featured} />

          {/* Others (small grid) */}
          {others.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {others.map((s) => (
                <CompactSeasonCard key={s.slug} season={s} />
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

function FeaturedSeasonCard({ season }: { season: (typeof seasons)[number] }) {
  const cfg = STATUS_CONFIG[season.status];
  return (
    <Link
      href={`/${season.slug}` as never}
      className="group block card-elevated rounded-xl border border-[var(--border)] overflow-hidden"
    >
      {/* Theme color top bar */}
      <div className="h-1 w-full" style={{ backgroundColor: season.themeColor }} />

      <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <div className="flex items-center gap-2 mb-3 text-xs">
            <StatusDot tone={cfg.tone} />
            <span className="text-[var(--text-secondary)] uppercase tracking-wider">{cfg.label}</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-[var(--text-muted)]">{season.kind}</span>
          </div>

          <h3 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] mb-2">
            {season.name}
          </h3>
          <p className="text-[var(--text-secondary)] text-sm sm:text-base leading-relaxed mb-3">
            {season.description}
          </p>
          <p className="text-xs text-[var(--text-muted)] tabular">{season.schedule}</p>
        </div>

        <div
          className="hidden sm:flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-[var(--text-primary)] border transition-colors"
          style={{
            backgroundColor: `${season.themeColor}1a`,
            borderColor: `${season.themeColor}40`,
          }}
        >
          进入赛季
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </Link>
  );
}

function CompactSeasonCard({ season }: { season: (typeof seasons)[number] }) {
  const cfg = STATUS_CONFIG[season.status];
  return (
    <Link
      href={`/${season.slug}` as never}
      className="block card-elevated rounded-lg border border-[var(--border)] overflow-hidden"
    >
      <div className="h-0.5 w-full" style={{ backgroundColor: season.themeColor }} />
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2 text-xs">
          <StatusDot tone={cfg.tone} />
          <span className="text-[var(--text-secondary)]">{cfg.label}</span>
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{season.name}</h3>
        <p className="text-sm text-[var(--text-muted)]">{season.kind}</p>
      </div>
    </Link>
  );
}
