import type { PublicDraftSummary } from "@/lib/draft/data";
import Link from "next/link";
import type { RegistrationMode, SeasonStatus } from "@/types/season";
import {
  presentRegistrationSchedule,
  presentSeasonParticipationState,
} from "@/lib/seasons/presentation";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { MiniStat, Panel, StatusPill } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import {
  SeasonDraftPreview,
  SeasonMatchPreview,
  SeasonVotingPreview,
  type SeasonPreviewCandidate,
  type SeasonPreviewMatch,
} from "@/components/season/SeasonStageHighlights";

export { shouldLoadRegistrationPositionCounts } from "@/lib/home/presentation";

interface HomePanelSeason {
  name: string;
  hasOfficialMatches?: boolean;
  hasCaptainVoting?: boolean;
  hasDraft?: boolean;
  slug: string;
  status: SeasonStatus;
  registrationMode: RegistrationMode;
  kind: string;
  positions: string[];
  registrationOpensAt: Date | null;
  registrationOpenedAt: Date | null;
  registrationClosesAt: Date | null;
}

interface HomeSeasonPanelProps {
  draftData?: PublicDraftSummary;
  season: HomePanelSeason;
  maxPerPosition: number;
  positionCountMap: Map<string, number>;
  topCandidatesWithNames: SeasonPreviewCandidate[];
  liveAndUpcomingMatches: SeasonPreviewMatch[];
  teamCount: number;
  playerCount: number;
  showSummary?: boolean;
}

export function HomeSeasonPanel({
  season,
  maxPerPosition,
  positionCountMap,
  topCandidatesWithNames,
  liveAndUpcomingMatches,
  teamCount,
  playerCount,
  draftData,
  showSummary = true,
}: HomeSeasonPanelProps) {
  const registrationSchedule = presentRegistrationSchedule(season);
  const historical = ["finished", "archived"].includes(season.status);
  const hasMatchActivity = !historical && (season.hasOfficialMatches || liveAndUpcomingMatches.length > 0);

  if (hasMatchActivity) {
    return (
      <Panel label={<div className="flex w-full flex-wrap items-center justify-between gap-3"><h2>近期比赛</h2><Link href={`/${season.slug}/matches`} className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">全部赛程 →</Link></div>}>
        <SeasonMatchPreview seasonSlug={season.slug} matches={liveAndUpcomingMatches} />
      </Panel>
    );
  }

  if (season.status === "voting" && season.hasCaptainVoting !== false) {
    return (
      <Panel label={<h2>队长投票</h2>}>
        <SeasonVotingPreview candidates={topCandidatesWithNames} />
        <Link href={`/${season.slug}/captains`} className="mt-5 inline-flex min-h-7 items-center text-sm text-[var(--color-accent)]">查看全部候选人 →</Link>
      </Panel>
    );
  }

  if (season.status === "drafting" && season.hasDraft !== false) {
    const complete = Boolean(draftData && draftData.maxPicks > 0 && draftData.totalPicks >= draftData.maxPicks);
    return (
      <Panel label={<h2>选秀进度</h2>}>
        <SeasonDraftPreview seasonSlug={season.slug} draftData={draftData ?? null} />
        <Link href={`/${season.slug}/draft`} className="mt-5 inline-flex min-h-7 items-center text-sm text-[var(--color-accent)]">{complete ? "回顾选秀" : "查看选秀"} →</Link>
      </Panel>
    );
  }

  const registrationOpen = getRegistrationWindowState(season).canSubmit;
  return (
    <Panel label={<h2>{registrationOpen ? "报名信息" : "赛事进展"}</h2>}>
      <div className="grid gap-4">
        {showSummary && <div><StatusPill {...presentSeasonParticipationState(season)} /><h3 className="mt-2 text-xl font-semibold">{season.name}</h3></div>}
        {registrationSchedule && (
          <div className="space-y-1 text-sm text-[var(--color-fg-mid)]">
            <p>{registrationSchedule.primary}</p>
            {registrationSchedule.secondary && <p>{registrationSchedule.secondary}</p>}
          </div>
        )}
        {registrationOpen && season.registrationMode === "solo" ? (
          <div className="grid gap-3">
            {season.positions.map((position) => {
              const filled = positionCountMap.get(position) ?? 0;
              const percentage = maxPerPosition > 0 ? Math.min(100, Math.round((filled / maxPerPosition) * 100)) : 0;
              return <div key={position}><div className="mb-1.5 flex justify-between font-mono text-xs text-[var(--color-fg-mid)]"><span className="uppercase">{position}</span><span>{filled} / {maxPerPosition}</span></div><div className="h-1 overflow-hidden rounded-full bg-[var(--color-border)]"><div className="h-full rounded-full" style={{ width: `${percentage}%`, background: percentage >= 90 ? "var(--color-warn)" : "var(--color-accent)" }} /></div></div>;
            })}
          </div>
        ) : showSummary && (
          <div className="grid grid-cols-2 gap-3 border-y border-[var(--color-border)] py-3">
            <MiniStat label={season.registrationMode === "team" && season.status === "registration" ? "已审核队伍" : "参赛队伍"} value={teamCount} />
            <MiniStat label="本届选手" value={playerCount} accent />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href={`/${season.slug}/info`} className="inline-flex min-h-7 items-center text-[var(--color-accent)]">赛事规则与信息 →</Link>
          <Link href={`/${season.slug}/${season.registrationMode === "team" ? "teams" : "players"}`} className="inline-flex min-h-7 items-center text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">{season.registrationMode === "team" ? "本届队伍" : "本届选手"} →</Link>
        </div>
        {showSummary && <Button variant="outline" asChild><Link href={`/${season.slug}`}>进入赛事 →</Link></Button>}
      </div>
    </Panel>
  );
}
