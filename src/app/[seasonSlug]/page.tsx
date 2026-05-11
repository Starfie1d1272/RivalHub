import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { UserPlus, Vote, Users, Swords, Shuffle, BarChart3 } from "lucide-react";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { normalizeStagePlan, SEASON_STATUS_LABELS } from "@/types/season";
import type { SeasonStatus } from "@/types/season";
import { showStats } from "@/lib/utils/season";

interface SeasonPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonPage({ params }: SeasonPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();
  const hasMatches = normalizeStagePlan(season.stagePlan).length > 0;

  const quickLinks = [
    {
      href: `/${seasonSlug}/register`,
      label: "立即报名",
      description: "提交报名信息",
      icon: UserPlus,
      show: true,
    },
    {
      href: `/${seasonSlug}/captains`,
      label: "队长投票",
      description: "为心仪队长投票",
      icon: Vote,
      show: season.hasCaptainVoting,
    },
    {
      href: `/${seasonSlug}/draft`,
      label: "选秀直播间",
      description: "实时观看选秀进度",
      icon: Shuffle,
      show: season.hasDraft,
    },
    {
      href: `/${seasonSlug}/teams`,
      label: "队伍阵容",
      description: "查看各队选手分布",
      icon: Users,
      show: true,
    },
    {
      href: `/${seasonSlug}/matches`,
      label: "赛程对决",
      description: "Bracket + 战报",
      icon: Swords,
      show: hasMatches,
    },
    {
      href: `/${seasonSlug}/stats`,
      label: "数据统计",
      description: "赛季排行榜与个人数据",
      icon: BarChart3,
      show: showStats(season),
    },
  ].filter((l) => l.show);

  return (
    <div className="container mx-auto px-4 py-10">
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
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text-primary)] mb-4 leading-tight">
          {season.name}
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickLinks.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href as never}
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
