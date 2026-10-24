import { isAdminMatchInScope } from "@/lib/admin/matches/workspace-filters";
import React from "react";
import { MatchWorkbenchLink as Link } from "./MatchWorkbenchLink";
import { Panel } from "@/components/rivalhub";
import { presentMatchStage } from "@/lib/matches/presentation";
import type { AdminPostMatchTaskRow } from "@/lib/admin/matches/postmatch-tasks";

export function AdminPostMatchTasks({ rows, seasonSlug, stage, team, stageNames, total, mineCount }: {
  total?: number; mineCount?: number; rows: AdminPostMatchTaskRow[]; seasonSlug: string; stage?: string; team?: string; stageNames: Record<string, string>;
}) {
  const scoped = rows.filter(row => isAdminMatchInScope(row, { stage, team }));
  if (scoped.length === 0) return <Panel><p className="text-sm text-[var(--color-fg-mid)]">当前范围没有待补齐的赛后资料。</p></Panel>;
  const mine = scoped.filter(row => row.isMine);
  const others = scoped.filter(row => !row.isMine);
  const list = (items: AdminPostMatchTaskRow[]) => <ul className="divide-y divide-[var(--color-border)]">
    {items.map(row => <li key={row.id} id={`material-${row.id}`} className="scroll-mt-4 min-w-0 space-y-2 py-3 text-sm">
      <p className="break-words"><strong>{row.teamAName} vs {row.teamBName}</strong><span className="ml-2 text-xs text-[var(--color-fg-mid)]">{stageNames[row.stage] ?? presentMatchStage(row.stage)}</span></p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{row.tasks.map((task, i) => <Link key={`${task.anchor}-${i}`} sourceAnchor={`material-${row.id}`}
        href={`/admin/${seasonSlug}/matches/${row.id}#${task.anchor}`}
        className="inline-flex min-h-6 items-center text-[var(--color-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">{task.label} →</Link>)}</div>
    </li>)}
  </ul>;
  return <Panel contentClassName="space-y-2 p-4">
    <h2 className="font-semibold">赛后待办 · {total ?? scoped.length} 场</h2>
    {mine.length > 0 && <section aria-label="我负责的赛后待办"><h3 className="text-sm font-medium">我负责的比赛</h3>{list(mine)}</section>}
    {others.length > 0 && <details open>
      <summary className="cursor-pointer text-sm text-[var(--color-fg-mid)]">其它比赛 · {total !== undefined && mineCount !== undefined ? total - mineCount : others.length} 场待补齐</summary>
      {list(others)}
    </details>}
  </Panel>;
}
