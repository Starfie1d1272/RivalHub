"use client";

import { useRef, useState, useTransition } from "react";
import { readCommentaryEffectiveness } from "@/app/admin/[seasonSlug]/matches/actions";
import type { AdminCommentaryEffectiveness } from "@/lib/admin/matches/types";
import { presentMatchLabel } from "@/lib/matches/presentation";
import { Button } from "@/components/ui/button";

export function CommentaryEffectivenessDetails({ seasonId, teamNames, stageNames }: {
  seasonId: string; teamNames: Record<string, string>; stageNames: Record<string, string>;
}) {
  const [data, setData] = useState<AdminCommentaryEffectiveness[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(false);
    startTransition(async () => {
      try {
        const result = await readCommentaryEffectiveness(seasonId);
        if (result.success) setData(result.data);
        else setError(true);
      } catch { setError(true); }
      finally { inFlight.current = false; }
    });
  }
  return <details className="rounded border border-[var(--color-border)] px-4 py-3"
    onToggle={event => { if (event.currentTarget.open && data === null && !error) load(); }}>
    <summary className="cursor-pointer text-sm font-medium">解说有效场次统计</summary>
    {pending && <p role="status" className="mt-3 text-sm">正在读取有效场次…</p>}
    {error && <p role="alert" className="mt-3 text-sm">无法读取有效场次。<Button variant="outline" onClick={load}>重试</Button></p>}
    {data && <div className="mt-3 space-y-3 text-sm">
      {data.length === 0 && <p>暂无有效场次。</p>}
      {data.map(({ admin, matches }) => <div key={admin.userId}>
        <strong>{admin.name}</strong> · {matches.length} 场
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--color-fg-mid)]">
          {matches.map(match => <li key={match.id}>{presentMatchLabel({ stage: match.stage, stageName: stageNames[match.stage],
            round: match.round, entryRound: match.entryRound, teamAName: teamNames[match.entryAId] ?? "待定", teamBName: teamNames[match.entryBId] ?? "待定" })}</li>)}
        </ul>
      </div>)}
    </div>}
  </details>;
}
