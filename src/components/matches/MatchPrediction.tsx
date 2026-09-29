import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import type { loadMatchPrediction } from "@/lib/matches/prediction-read-model";

export function MatchPrediction({ data, teamAName, teamBName, entryAId, seasonSlug }: {
  data: NonNullable<Awaited<ReturnType<typeof loadMatchPrediction>>>;
  teamAName: string;
  teamBName: string;
  entryAId: string;
  seasonSlug: string;
}) {
  const a = data.shares.find(row => row.entryId === entryAId)?.percent ?? null;
  const b = data.shares.find(row => row.entryId !== entryAId)?.percent ?? null;
  return <Panel label="积分池占比" contentClassName="space-y-3 p-4">
    <div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{teamAName} · {a === null ? "—" : `${a}%`}</span><span className="min-w-0 truncate text-right">{teamBName} · {b === null ? "—" : `${b}%`}</span></div>
    <div className="flex h-2 overflow-hidden rounded bg-[var(--color-panel-lo)]" aria-label="社区投入占比"><span className="bg-[var(--color-accent)]" style={{ width: `${a ?? 0}%` }} /><span className="bg-[var(--color-accent-b)]" style={{ width: `${b ?? 0}%` }} /></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-mid)]"><span>社区投入占比 · {data.participants} 人参与</span><span>{data.closed ? "已截止" : `截止 ${new Date(data.deadline).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`}</span></div>
    {data.myStake && BigInt(data.myStake) > BigInt(0) && <p className="text-xs">我的投入：{data.myStake} 积分</p>}
    <Link href={`/${seasonSlug}/predictions`} className="inline-flex min-h-10 items-center text-sm text-[var(--color-accent)] hover:underline">进入积分预测 →</Link>
  </Panel>;
}
