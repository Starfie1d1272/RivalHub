"use client";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "@/components/rivalhub";
import { correctMapScore } from "@/actions/matches";
import { previewSeriesMapCorrection } from "@/actions/matches/series-correction";
import type { SeriesCorrectionPreview } from "@/lib/matches/series-score-correction";
import { SeriesScoreCorrectionReview } from "./SeriesScoreCorrectionReview";
import { mapLabel } from "@/lib/maps";

export function MapScoreCorrectInput({ entryAId, entryBId, seasonSlug, matchId, matchInProgress = false, mapId, mapName, scoreA, scoreB, teamAName, teamBName }: {
  entryAId?: string; entryBId?: string; seasonSlug?: string; matchId?: string; matchInProgress?: boolean; mapId: string; mapName: string; scoreA: number; scoreB: number; teamAName: string; teamBName: string;
}) {
  const [seriesPreview, setSeriesPreview] = useState<SeriesCorrectionPreview | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [valA, setValA] = useState(String(scoreA));
  const [valB, setValB] = useState(String(scoreB));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <div className="space-y-3 text-sm">
    {!editing ? <Button size="sm" variant="outline" onClick={() => { setValA(String(scoreA)); setValB(String(scoreB)); setEditing(true); }}>更正比分</Button> : <form className="space-y-3 rounded border border-[var(--color-border)] p-3" onSubmit={event => { event.preventDefault(); setError("");
      if (!matchInProgress || !matchId) { setConfirming(true); return; }
      startTransition(async () => {
        const result = await previewSeriesMapCorrection({ matchId, mapId, scoreA: Number(valA), scoreB: Number(valB), expectedScoreA: scoreA, expectedScoreB: scoreB });
        if (!result.success) { setError(result.error.message); return; }
        setSeriesPreview(result.data); setConfirming(result.data === null);
      }); }}>
      <p>{mapLabel(mapName)} · 正式比分 {scoreA}:{scoreB}</p>
      <div className="flex flex-wrap items-end gap-3">
        <TeamProfileLink seasonSlug={seasonSlug} entryId={entryAId}>{teamAName}</TeamProfileLink>
        <TeamProfileLink seasonSlug={seasonSlug} entryId={entryBId}>{teamBName}</TeamProfileLink>
        <label className="space-y-1">{teamAName}<Input aria-label={`${teamAName}更正比分`} type="number" min="0" step="1" required value={valA} onChange={event => { setValA(event.target.value); setConfirming(false); setSeriesPreview(null); }} className="w-24" disabled={pending} /></label>
        <label className="space-y-1">{teamBName}<Input aria-label={`${teamBName}更正比分`} type="number" min="0" step="1" required value={valB} onChange={event => { setValB(event.target.value); setConfirming(false); setSeriesPreview(null); }} className="w-24" disabled={pending} /></label>
      </div>
      <label className="block space-y-1">更正原因<Input required maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setConfirming(false); }} disabled={pending} /></label>
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
      {seriesPreview && matchId ? <SeriesScoreCorrectionReview entryAId={entryAId} entryBId={entryBId} seasonSlug={seasonSlug} preview={seriesPreview} request={{ matchId, mapId, scoreA: Number(valA), scoreB: Number(valB), expectedScoreA: scoreA, expectedScoreB: scoreB }} initialReason={reason} teamAName={teamAName} teamBName={teamBName} onCancel={() => { setSeriesPreview(null); setConfirming(false); }} onDone={() => { setSeriesPreview(null); setEditing(false); }} /> : pending ? <p role="status">正在保存更正…</p> : confirming ? <InlineConfirm title={`确认更正为 ${valA}:${valB}？`} sub="将更新本图比分与系列赛地图胜数，保存更正原因。已同步的 Demo 会按新比分重新核对。" onCancel={() => setConfirming(false)} onConfirm={() => startTransition(async () => {
        const result = await correctMapScore(mapId, Number(valA), Number(valB), { expectedScoreA: scoreA, expectedScoreB: scoreB, reason });
        if (!result.success) { setError(result.error.message); setConfirming(false); }
        else { toast.success("比分已更正"); setEditing(false); setConfirming(false); router.refresh(); }
      })} /> : <div className="flex gap-2"><Button size="sm" type="submit" disabled={pending}>核对更正</Button><Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>取消</Button></div>}
    </form>}
  </div>;
}
