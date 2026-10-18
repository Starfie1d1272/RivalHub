import Link from "next/link";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { StatusPill } from "@/components/rivalhub";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { Button } from "@/components/ui/button";
import type { PublicDraftSummary } from "@/lib/draft/data";
import { presentMatchFormat } from "@/lib/matches/presentation";
import { formatCSTDateTime } from "@/lib/utils/date";
import { DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import { isMatchFormat, isMatchStatus } from "@/types/match";

export interface SeasonPreviewCandidate {
  userId?: string;
  name: string;
  voteCount: number;
}

export function SeasonVotingPreview({
  candidates,
}: {
  candidates: readonly SeasonPreviewCandidate[];
}) {
  if (candidates.length === 0) {
    return <p className="py-3 text-sm text-[var(--color-fg-mid)]">暂无候选队长</p>;
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {candidates.map((candidate) => (
        <li key={candidate.userId ?? candidate.name} className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <span className="min-w-0 truncate font-semibold text-[var(--color-fg)]">
            {candidate.userId ? (
              <PlayerProfileLink userId={candidate.userId} className="inline-flex min-h-6 items-center">
                {candidate.name}
              </PlayerProfileLink>
            ) : candidate.name}
          </span>
          <span className="shrink-0 font-mono text-xl tabular-nums text-[var(--color-fg)]">
            {candidate.voteCount}
            <span className="ml-1.5 text-xs text-[var(--color-fg-dim)]">票</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SeasonDraftPreview({
  seasonSlug,
  draftData,
}: {
  seasonSlug: string;
  draftData: PublicDraftSummary | null;
}) {
  if (!draftData) {
    return <p className="py-3 text-sm text-[var(--color-fg-mid)]">选秀信息待公布</p>;
  }

  const complete = draftData.maxPicks > 0 && draftData.totalPicks >= draftData.maxPicks;
  const state = draftData.state;
  const currentTeam = draftData.teams.find((team) => team.entryId === state?.currentEntryId);
  const label = complete ? "阵容已完成" : !state ? "选秀预览" : state.isActive ? "选秀进行中" : "选秀已暂停";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill label={label} tone={complete ? "success" : "accent"} />
        <p className="font-mono text-xl tabular-nums text-[var(--color-fg)]">
          {draftData.totalPicks}
          <span className="text-sm text-[var(--color-fg-mid)]"> / {draftData.maxPicks} 已选</span>
        </p>
      </div>
      {draftData.maxPicks > 0 && (
        <div
          role="progressbar"
          aria-label="选秀进度"
          aria-valuemin={0}
          aria-valuemax={draftData.maxPicks}
          aria-valuenow={draftData.totalPicks}
          className="h-1 overflow-hidden rounded-full bg-[var(--color-border)]"
        >
          <div
            className="h-full bg-[var(--color-accent)]"
            style={{ width: `${Math.min(100, (draftData.totalPicks / draftData.maxPicks) * 100)}%` }}
          />
        </div>
      )}
      {state && !complete && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-6 pt-1">
          <div>
            <dt className="mb-1.5 text-xs text-[var(--color-fg-mid)]">当前轮次</dt>
            <dd className="font-mono text-xl tabular-nums">{state.currentRound} / {DRAFT_TOTAL_ROUNDS}</dd>
          </div>
          <div className="min-w-0">
            <dt className="mb-1.5 text-xs text-[var(--color-fg-mid)]">{state.isActive ? "当前选择" : "等待恢复"}</dt>
            <dd className="truncate font-semibold">
              {currentTeam ? (
                <TeamProfileLink seasonSlug={seasonSlug} entryId={currentTeam.entryId} className="inline-flex min-h-7 items-center">
                  {currentTeam.teamName}
                </TeamProfileLink>
              ) : "等待队伍"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export interface SeasonPreviewMatch {
  id: string;
  entryAId: string | null;
  entryBId: string | null;
  status: string;
  scheduledAt: Date | string | null;
  format?: string | null;
  stageLabel?: string | null;
  teamAName: string | null;
  teamBName: string | null;
}

export function SeasonMatchPreview({
  seasonSlug,
  matches,
  stageLabel,
}: {
  seasonSlug: string;
  matches: readonly SeasonPreviewMatch[];
  stageLabel?: string | null;
}) {
  if (matches.length === 0) {
    return <p className="py-3 text-sm text-[var(--color-fg-mid)]">暂无待进行比赛</p>;
  }

  return (
    <div className="divide-y divide-[var(--color-border)]">
      {matches.map((match) => {
        const matchStageLabel = match.stageLabel ?? stageLabel;
        const teamAName = match.teamAName ?? "待定";
        const teamBName = match.teamBName ?? "待定";

        return (
          <article key={match.id} className="min-w-0 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-fg-mid)]">
              {isMatchStatus(match.status) && <MatchStatusBadge status={match.status} scheduledAt={match.scheduledAt} />}
              {matchStageLabel && <span>{matchStageLabel}</span>}
              {match.format && isMatchFormat(match.format) && <span className="font-mono">{presentMatchFormat(match.format).label}</span>}
              {match.scheduledAt && <span className="ml-auto font-mono tabular-nums">{formatCSTDateTime(match.scheduledAt)}</span>}
            </div>
            <div className="mt-2 grid min-w-0 items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm font-semibold text-[var(--color-fg)] sm:text-base">
                <TeamProfileLink seasonSlug={seasonSlug} entryId={match.entryAId} className="block min-h-7 truncate py-1 text-right" title={teamAName}>
                  {teamAName}
                </TeamProfileLink>
                <span className="font-mono text-xs font-normal text-[var(--color-fg-dim)]">VS</span>
                <TeamProfileLink seasonSlug={seasonSlug} entryId={match.entryBId} className="block min-h-7 truncate py-1" title={teamBName}>
                  {teamBName}
                </TeamProfileLink>
              </div>
              <Button variant="ghost" size="sm" className="justify-self-end text-[var(--color-accent)]" asChild>
                <Link href={`/${seasonSlug}/matches/${match.id}`} aria-label={`查看 ${teamAName} 对 ${teamBName} 比赛`}>
                  查看比赛 <span aria-hidden>→</span>
                </Link>
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
