"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmSeriesMapCorrection } from "@/actions/matches/series-correction";
import type { SeriesCorrectionPreview, SeriesCorrectionRequest } from "@/lib/matches/series-score-correction";

export function SeriesScoreCorrectionReview({ preview, request, teamAName, teamBName, onCancel, onDone }: {
  preview: SeriesCorrectionPreview; request: SeriesCorrectionRequest;
  teamAName: string; teamBName: string; onCancel: () => void; onDone: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!opened) return <div className="space-y-2">
    <p>本次地图更正将提前结束系列赛，请核对整场影响后确认。</p>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpened(true)}>进入系列赛果更正</Button>
  </div>;
  return <section aria-label="更正系列赛果" className="space-y-3 rounded border border-[var(--color-border)] p-3">
    <h3 className="font-semibold">更正系列赛果</h3>
    <p>当前：{teamAName} {preview.currentA} : {preview.currentB} {teamBName}</p>
    <p>更正后：{teamAName} {preview.scoreA} : {preview.scoreB} {teamBName}</p>
    <p>Map {preview.correctedMapOrder}：{preview.oldA} : {preview.oldB} → {preview.newA} : {preview.newB}</p>
    <p>比赛状态：进行中 → 已结束</p>
    <ul className="list-inside list-disc">{preview.maps.map(map => <li key={map.order}>Map {map.order}：{map.label}</li>)}</ul>
    <p>{preview.progressionLabel}</p>
    <p>{preview.downstreamCount ? `已有 ${preview.downstreamCount} 场后续比赛` : "尚无后续比赛"}；{preview.postTasksExist ? "已有赛后数据或资料，需要按更正后的比分核对" : "尚无赛后数据或资料"}</p>
    <p>已同步的 Demo 需重新核验；平台计分板保留。</p>
    {preview.blockers.length ? <div role="alert" className="space-y-1 text-[var(--color-danger)]"><p>无法直接完成更正</p>{preview.blockers.map(message => <p key={message}>{message}</p>)}</div> : <>
      <label className="block space-y-1">整场更正原因<Input aria-label="整场更正原因" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} disabled={pending} /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} /><span>我已核对实际比赛事实，后续地图尚未开打，确认结束比赛并重新核算晋级结果</span></label>
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
      <Button type="button" size="sm" disabled={pending || !reason.trim() || !confirmed || Boolean(error)} onClick={() => startTransition(async () => {
        const result = await confirmSeriesMapCorrection({ ...request, previewRevision: preview.revision, reason, confirmed: true, laterMapsNotStarted: true });
        if (!result.success) { setError(result.error.message); return; }
        toast.success("系列赛果已更正，比赛已结束"); onDone(); router.refresh();
      })}>{pending ? "正在更正…" : "确认更正系列赛果"}</Button>
    </>}
    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>返回重新核对</Button>
  </section>;
}
