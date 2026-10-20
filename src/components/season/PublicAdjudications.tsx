import Link from "next/link";
import type { PublicSeasonResults } from "@/lib/seasons/public-results";
import { formatCSTShortDate } from "@/lib/utils/date";

export function PublicAdjudications({ adjudications, seasonSlug }: { adjudications: PublicSeasonResults["adjudications"]; seasonSlug: string }) {
  if (!adjudications.length) return null;
  return <details className="border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-fg-mid)]">
    <summary className="cursor-pointer">赛事裁决 · {adjudications.length}</summary>
    <div className="mt-2 divide-y divide-[var(--color-border)]">{adjudications.map((ruling) => <article key={ruling.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{ruling.targetEntryId ? <Link className="hover:underline" href={`/${seasonSlug}/teams/${ruling.targetEntryId}`}>{ruling.targetName}</Link>
          : ruling.targetUserId ? <Link className="hover:underline" href={`/players/${ruling.targetUserId}`}>相关选手</Link>
            : ruling.targetMatchId ? <Link className="hover:underline" href={`/${seasonSlug}/matches/${ruling.targetMatchId}`}>相关比赛</Link> : "本届赛事"}</span>
        <span className="text-xs">{ruling.status === "revoked" ? "已撤销" : "生效中"} · {formatCSTShortDate(ruling.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words">{ruling.explanation}</p>
    </article>)}</div>
  </details>;
}
