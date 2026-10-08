import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { CancelCommentaryButton } from "./CancelCommentaryButton";
import { ClaimMatchButton } from "./ClaimMatchButton";
import type { AdminCommentaryMatch, AdminMatchCommentaryAssignment, AdminMatchCommentaryData } from "@/lib/admin/matches/commentary";
import { formatCSTDateTime } from "@/lib/utils/date";
import { presentMatchStatus } from "@/lib/matches/presentation";

export function MatchCommentaryStatus({ matchId, assignment }: { matchId: string; assignment: AdminMatchCommentaryAssignment }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <span>{assignment.commentators.length === 0 ? "尚无解说" : <>解说：{assignment.commentators.map((person, index) => <React.Fragment key={person.userId}>{index > 0 ? "、" : null}{person.playerUserId ? <PlayerProfileLink userId={person.playerUserId}>{person.name}</PlayerProfileLink> : person.name}</React.Fragment>)}</>}</span>
    {assignment.isMine && <span className="text-[var(--color-accent)]">你已认领本场解说</span>}
    {assignment.canCancel && <CancelCommentaryButton key={matchId} matchId={matchId} />}
    {assignment.cancellationBlockedReason && <span className="text-[var(--color-fg-mid)]">{assignment.cancellationBlockedReason}</span>}
    {assignment.canClaim && <ClaimMatchButton matchId={matchId} />}
  </div>;
}

export function CommentaryMatchLink({ match, seasonSlug }: { match: AdminCommentaryMatch; seasonSlug: string }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
    {match.isTest && <span className="text-xs text-[var(--color-fg-mid)]">测试赛</span>}
    <TeamProfileLink seasonSlug={seasonSlug} entryId={match.entryAId}>{match.teamAName}</TeamProfileLink>
    <span className="text-[var(--color-fg-mid)]">vs</span>
    <TeamProfileLink seasonSlug={seasonSlug} entryId={match.entryBId}>{match.teamBName}</TeamProfileLink>
    <Link href={`/admin/${seasonSlug}/matches/${match.id}`} className="break-words font-medium text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
      {match.scheduledAt ? formatCSTDateTime(match.scheduledAt) : "尚未排期"} · 进入比赛工作台
    </Link>
  </div>;
}

export function MatchCommentaryQueue({ data, seasonSlug }: { data: AdminMatchCommentaryData; seasonSlug: string }) {
  return <Panel contentClassName="space-y-4 p-4">
    <section className="space-y-2" aria-labelledby="my-current-commentary">
      <h2 id="my-current-commentary" className="font-semibold">我的当前比赛</h2>
      {data.currentMatches.length > 0 ? <ul className="space-y-2">{data.currentMatches.map((match) => <li key={match.id}><CommentaryMatchLink match={match} seasonSlug={seasonSlug} /></li>)}</ul>
        : <p className="text-sm text-[var(--color-fg-mid)]">当前没有正在进行的已认领比赛</p>}
    </section>
    <section className="space-y-2 border-t border-[var(--color-border)] pt-3" aria-labelledby="my-next-commentary">
      <h2 id="my-next-commentary" className="font-semibold">我的下一场</h2>
      {data.nextMatch ? <><CommentaryMatchLink match={data.nextMatch} seasonSlug={seasonSlug} /><MatchCommentaryStatus matchId={data.nextMatch.id} assignment={data.byMatchId[data.nextMatch.id]!} /></>
        : <p className="text-sm text-[var(--color-fg-mid)]">当前没有已认领的下一场</p>}
    </section>
    <section className="space-y-2 border-t border-[var(--color-border)] pt-3" aria-labelledby="claimable-commentary">
      <h2 id="claimable-commentary" className="font-semibold">可认领的比赛</h2>
      {data.claimableMatches.length > 0 ? <ul className="divide-y divide-[var(--color-border)]">{data.claimableMatches.map((match) => <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <CommentaryMatchLink match={match} seasonSlug={seasonSlug} />
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>{presentMatchStatus(match.status, { scheduledAt: match.scheduledAt }).label} · 解说 {data.byMatchId[match.id]?.commentators.length ?? 0}/2</span>{data.byMatchId[match.id]?.canClaim && <ClaimMatchButton matchId={match.id} />}</div>
      </li>)}</ul> : <p className="text-sm text-[var(--color-fg-mid)]">当前没有待认领的比赛</p>}
    </section>
  </Panel>;
}
