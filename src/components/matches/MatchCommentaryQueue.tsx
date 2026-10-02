import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { ClaimMatchButton } from "./ClaimMatchButton";
import type { AdminCommentaryMatch, AdminMatchCommentaryAssignment, AdminMatchCommentaryData } from "@/lib/admin/matches/commentary";
import { formatCSTDateTime } from "@/lib/utils/date";
import { presentMatchStatus } from "@/lib/matches/presentation";

export function MatchCommentaryStatus({ matchId, assignment }: { matchId: string; assignment: AdminMatchCommentaryAssignment }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <span>{assignment.commentators.length === 0 ? "尚无解说" : <>解说：{assignment.commentators.map((person, index) => <React.Fragment key={person.userId}>{index > 0 ? "、" : null}<PlayerProfileLink userId={person.userId}>{person.name}</PlayerProfileLink></React.Fragment>)}</>}</span>
    {assignment.isMine && <span className="text-[var(--color-accent)]">你已负责本场</span>}
    {assignment.commentators.length === 0 && assignment.canClaim && <ClaimMatchButton matchId={matchId} />}
  </div>;
}

export function CommentaryMatchLink({ match, seasonSlug }: { match: AdminCommentaryMatch; seasonSlug: string }) {
  return <Link href={`/admin/${seasonSlug}/matches/${match.id}`} className="break-words text-sm font-medium text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
    {match.teamAName} vs {match.teamBName} · {match.scheduledAt ? formatCSTDateTime(match.scheduledAt) : "尚未排期"}
  </Link>;
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
      {data.nextMatch ? <CommentaryMatchLink match={data.nextMatch} seasonSlug={seasonSlug} />
        : <p className="text-sm text-[var(--color-fg-mid)]">当前没有已认领的下一场</p>}
    </section>
    <section className="space-y-2 border-t border-[var(--color-border)] pt-3" aria-labelledby="unclaimed-commentary">
      <h2 id="unclaimed-commentary" className="font-semibold">尚无解说的比赛</h2>
      {data.unclaimedMatches.length > 0 ? <ul className="divide-y divide-[var(--color-border)]">{data.unclaimedMatches.map((match) => <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <CommentaryMatchLink match={match} seasonSlug={seasonSlug} />
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>{presentMatchStatus(match.status, { scheduledAt: match.scheduledAt }).label} · 尚无解说</span>{data.byMatchId[match.id]?.canClaim && <ClaimMatchButton matchId={match.id} />}</div>
      </li>)}</ul> : <p className="text-sm text-[var(--color-fg-mid)]">当前没有待认领的比赛</p>}
      {data.unclaimedCount > data.unclaimedMatches.length && <p className="text-xs text-[var(--color-fg-mid)]">共 {data.unclaimedCount} 场尚无解说，其余比赛可在下方赛程中认领。</p>}
    </section>
  </Panel>;
}
