import Link from "next/link";
import { UserPlus, Vote, Users, Swords } from "lucide-react";
import { notFound } from "next/navigation";
import { SEASON_STATUS_LABELS } from "@/types/season";
import type { SeasonStatus } from "@/types/season";

// Mock season data — replaced with DB query in Phase 4+
const MOCK_SEASONS: Record<string, {
  name: string;
  kind: string;
  status: string;
  description: string;
  themeColor: string;
  schedule: string;
}> = {
  "2026-nju-rivals": {
    name: "2026 NJU Rivals",
    kind: "选秀联赛",
    status: "registration",
    description: "南京大学 CS2 社群选秀联赛，56 选手 · 8 队伍 · 双败淘汰。报名开放至 2026 春季。",
    themeColor: "#f97316",
    schedule: "2026 年春季",
  },
};

interface QuickLink {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const QUICK_LINKS: QuickLink[] = [
  { href: "register", label: "立即报名",  description: "提交报名信息",    icon: UserPlus },
  { href: "captains", label: "队长投票",  description: "为心仪队长投票",  icon: Vote },
  { href: "teams",    label: "队伍阵容",  description: "8 队选手分布",    icon: Users },
  { href: "matches",  label: "赛程对决",  description: "Bracket + 战报", icon: Swords },
];

interface SeasonPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonPage({ params }: SeasonPageProps) {
  const { seasonSlug } = await params;
  const season = MOCK_SEASONS[seasonSlug];
  if (!season) notFound();

  return (
    <div className="container mx-auto px-4 py-10">
      {/* Hero with theme glow */}
      <div className="season-glow relative mb-12 pt-6">
        <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-wider">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
            style={{
              backgroundColor: `rgba(var(--season-primary-rgb), 0.12)`,
              borderColor: `rgba(var(--season-primary-rgb), 0.4)`,
              color: "var(--season-primary)",
            }}
          >
            {SEASON_STATUS_LABELS[season.status as SeasonStatus] ?? season.status}
          </span>
          <span className="text-[var(--text-muted)]">{season.kind}</span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="text-[var(--text-muted)] tabular">{season.schedule}</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-primary)] mb-4 leading-tight">
          {season.name}
        </h1>
        <p className="text-[var(--text-secondary)] text-base sm:text-lg max-w-2xl leading-relaxed">
          {season.description}
        </p>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {QUICK_LINKS.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={`/${seasonSlug}/${href}` as never}
            className="card-elevated group flex flex-col gap-2 p-5 rounded-lg border border-[var(--border)]"
          >
            <div
              className="inline-flex items-center justify-center w-10 h-10 rounded-md mb-1 transition-colors"
              style={{
                backgroundColor: `rgba(var(--season-primary-rgb), 0.1)`,
                color: "var(--season-primary)",
              }}
            >
              <Icon size={18} />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{label}</h3>
            <p className="text-xs text-[var(--text-muted)]">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
