import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { UserPlus, Vote, Users, Swords, Shuffle, BarChart3 } from "lucide-react";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { normalizeStagePlan } from "@/types/season";
import type { SeasonStatus } from "@/types/season";
import { showStats } from "@/lib/utils/season";
import { StatusPill, Panel, Marker } from "@/components/rivalhub";

const ALL_PHASES = [
  { key: "register", label: "REGISTER", after: "registration" as SeasonStatus, required: true },
  { key: "vote", label: "VOTE", after: "voting" as SeasonStatus, required: "hasCaptainVoting" as const },
  { key: "draft", label: "DRAFT", after: "drafting" as SeasonStatus, required: "hasDraft" as const },
  { key: "qualifiers", label: "REGULAR", after: "playing" as SeasonStatus, required: true },
  { key: "playoffs", label: "PLAYOFFS", after: "finished" as SeasonStatus, required: true },
  { key: "finals", label: "FINALS", after: "archived" as SeasonStatus, required: true },
];

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

  const PHASES = ALL_PHASES.filter((phase) => {
    if (phase.required === true) return true;
    if (phase.required === "hasCaptainVoting") return season.hasCaptainVoting;
    if (phase.required === "hasDraft") return season.hasDraft;
    return false;
  });

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
      <div className="relative mb-12 pt-6">
        <div className="flex items-center gap-3 mb-4 text-xs uppercase tracking-wider">
          <StatusPill status={season.status} />
          <span className="text-[var(--color-fg-dim)]">{season.kind}</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--color-fg)] mb-4 leading-tight">
          {season.name}
        </h1>
      </div>

      {/* Phase tracker */}
      <Panel pad={0}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${PHASES.length}, 1fr)` }}>
          {(() => {
            const statusOrder: SeasonStatus[] = ["draft", "registration", "voting", "drafting", "playing", "finished", "archived"];
            const currentIdx = statusOrder.indexOf(season.status);
            const thresholdIdx = Object.fromEntries(PHASES.map((p) => [p.key, statusOrder.indexOf(p.after)]));
            return PHASES.map((phase, i) => {
              const phaseDone = currentIdx >= thresholdIdx[phase.key];
              const prevKey = i > 0 ? PHASES[i - 1].key : "";
              const isCurrent = !phaseDone && (i === 0 || currentIdx >= (thresholdIdx[prevKey] ?? Infinity));
              return (
                <div key={phase.key}
                  className="relative"
                  style={{
                    padding: "18px 16px",
                    borderRight: i < PHASES.length - 1 ? "1px solid var(--color-border)" : "none",
                    background: isCurrent ? "var(--color-panel-hi)" : "transparent",
                  }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="grid place-items-center font-bold rounded-sm" style={{
                      width: 16, height: 16,
                      border: `1px solid ${phaseDone ? "var(--color-ok)" : isCurrent ? "var(--color-accent)" : "var(--color-border)"}`,
                      background: phaseDone ? "var(--color-ok)22" : isCurrent ? "var(--color-accent)22" : "transparent",
                      fontFamily: "var(--font-mono)", fontSize: 10,
                      color: phaseDone ? "var(--color-ok)" : isCurrent ? "var(--color-accent)" : "var(--color-fg-dim)",
                    }}>
                      {phaseDone ? "✓" : i + 1}
                    </div>
                    <div className="uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                      STEP {i + 1}
                    </div>
                  </div>
                  <div className="font-semibold" style={{
                    fontFamily: "var(--font-display)", fontSize: 14,
                    color: phaseDone ? "var(--color-fg)" : isCurrent ? "var(--color-accent)" : "var(--color-fg-mid)",
                    letterSpacing: "0.04em",
                  }}>
                    {phase.label}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </Panel>

      <Marker sub="快速访问各功能模块">赛季导航</Marker>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickLinks.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href as never} className="group">
            <Panel>
              <div className="flex flex-col gap-2">
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-md mb-1 transition-colors"
                  style={{
                    backgroundColor: `rgba(255, 107, 26, 0.1)`,
                    color: "var(--color-accent)",
                  }}
                >
                  <Icon size={18} />
                </div>
                <h3 className="text-sm font-semibold text-[var(--color-fg)]">{label}</h3>
                <p className="text-xs text-[var(--color-fg-dim)]">{description}</p>
              </div>
            </Panel>
          </Link>
        ))}
      </div>
    </div>
  );
}
