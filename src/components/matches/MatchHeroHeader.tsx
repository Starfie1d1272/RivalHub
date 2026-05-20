import React from "react";
import Image from "next/image";
import Link from "next/link";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { PosChip, TeamBadge } from "@/components/rivalhub";
import { formatCSTDateTime } from "@/lib/utils/date";
import { MATCH_FORMAT_LABELS, MATCH_STAGE_LABELS } from "@/types/match";
import { teamBadgeData } from "@/lib/matches/detail-stats";

interface MatchHeroTeam {
  id: string;
  name: string;
  logoUrl: string | null;
}

interface MatchHeroMatch {
  id: string;
  teamAId: string;
  teamBId: string;
  stage: string;
  format: keyof typeof MATCH_FORMAT_LABELS;
  status: "scheduled" | "in_progress" | "finished" | "cancelled" | string;
  scoreA: number | null;
  scoreB: number | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  bracketNodeId: string | null;
}

interface MatchHeroHeaderProps {
  seasonSlug: string;
  match: MatchHeroMatch;
  teamA: MatchHeroTeam | null | undefined;
  teamB: MatchHeroTeam | null | undefined;
  isFinished: boolean;
}

export function MatchHeroHeader({
  seasonSlug,
  match,
  teamA,
  teamB,
  isFinished,
}: MatchHeroHeaderProps) {
  return (
    <>
      <div className="flex items-center gap-4">
        <Link
          href={`/${seasonSlug}/matches`}
          className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← 返回赛程总览
        </Link>
        {match.stage === "playoff" && match.bracketNodeId && (
          <Link
            href={`/${seasonSlug}/matches#bracket`}
            className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
          >
            查看对阵图 →
          </Link>
        )}
      </div>

      <div
        className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 py-8"
        style={{
          background:
            teamA && teamB
              ? `linear-gradient(90deg, ${teamBadgeData(teamA.name, 0).color}15 0%, transparent 35%, transparent 65%, ${teamBadgeData(teamB.name, 1).color}15 100%)`
              : `var(--color-panel-low)`,
          borderRadius: "var(--radius-lg)",
          border: `1px solid var(--color-border)`,
        }}
      >
        <div className="flex items-center gap-4 justify-end">
          <div className="text-right min-w-0">
            <Link
              href={`/${seasonSlug}/teams/${match.teamAId}`}
              className="font-bold text-lg sm:text-[28px] hover:text-[var(--color-accent)] transition-colors"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamA?.name ?? "未知队伍"}
            </Link>
          </div>
          {teamA && (
            <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0">
              {teamA.logoUrl ? (
                <Image
                  src={teamA.logoUrl}
                  alt={teamA.name}
                  width={64}
                  height={64}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <TeamBadge team={teamBadgeData(teamA.name, 0)} size={64} />
              )}
            </div>
          )}
        </div>

        <div className="text-center px-4">
          {match.status === "in_progress" && (
            <div
              className="inline-block mb-2 px-2.5 py-0.5 rounded-sm font-bold"
              style={{
                background: "var(--color-danger)",
                color: "var(--color-accent-fg)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "var(--tracking-label)",
              }}
            >
              ● LIVE
            </div>
          )}
          {isFinished ? (
            <div
              className="font-bold text-4xl sm:text-[56px]"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--color-fg)",
                letterSpacing: "-0.04em",
                lineHeight: 1,
              }}
            >
              {match.scoreA ?? 0}
              <span className="mx-3" style={{ color: "var(--color-fg-dim)", fontSize: 24 }}>:</span>
              {match.scoreB ?? 0}
            </div>
          ) : (
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 42,
                color: "var(--color-fg-dim)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              VS
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
            <PosChip pos={MATCH_STAGE_LABELS[match.stage] ?? match.stage} />
            <PosChip pos={MATCH_FORMAT_LABELS[match.format] ?? match.format} />
            <MatchStatusBadge status={match.status as "scheduled" | "in_progress" | "finished" | "cancelled"} />
          </div>
        </div>

        <div className="flex items-center gap-4">
          {teamB && (
            <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0">
              {teamB.logoUrl ? (
                <Image
                  src={teamB.logoUrl}
                  alt={teamB.name}
                  width={64}
                  height={64}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <TeamBadge team={teamBadgeData(teamB.name, 1)} size={64} />
              )}
            </div>
          )}
          <div className="min-w-0">
            <Link
              href={`/${seasonSlug}/teams/${match.teamBId}`}
              className="font-bold text-lg sm:text-[28px] hover:text-[var(--color-accent)] transition-colors"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-fg)",
                letterSpacing: "var(--tracking-tight-1)",
              }}
            >
              {teamB?.name ?? "未知队伍"}
            </Link>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-[var(--color-fg-dim)]">
        {isFinished
          ? match.completedAt
            ? `完成于 ${formatCSTDateTime(match.completedAt)}`
            : "结束时间未记录"
          : match.scheduledAt
          ? `计划于 ${formatCSTDateTime(match.scheduledAt)}`
          : "未排期"}
      </div>
    </>
  );
}
