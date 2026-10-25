"use client";
import { MatchRecordingEditor } from "./MatchRecordingEditor";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { retryPostMatchRefresh, addMatchCommentator as telemetry_addMatchCommentator, removeMatchCommentator as telemetry_removeMatchCommentator, revokePostMatchSubmission as telemetry_revokePostMatchSubmission, submitPostMatchReport as telemetry_submitPostMatchReport, updateMatchVideoUrl as telemetry_updateMatchVideoUrl } from "@/actions/postmatch";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub/InlineConfirm";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { AdminPostMatchRecordData } from "@/lib/admin/matches/types";
import { observeAction } from "@/lib/telemetry/client";

const addMatchCommentator = observeAction("postmatch.addMatchCommentator", telemetry_addMatchCommentator);
const removeMatchCommentator = observeAction("postmatch.removeMatchCommentator", telemetry_removeMatchCommentator);
const revokePostMatchSubmission = observeAction("postmatch.revokePostMatchSubmission", telemetry_revokePostMatchSubmission);
const submitPostMatchReport = observeAction("postmatch.submitPostMatchReport", telemetry_submitPostMatchReport);
const updateMatchVideoUrl = observeAction("postmatch.updateMatchVideoUrl", telemetry_updateMatchVideoUrl);

export type PostMatchRecordData = AdminPostMatchRecordData;
export function PostMatchRecordPanel({ matchId, data }: { matchId: string; data: PostMatchRecordData }) {
  const [isPending, startTransition] = useTransition();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [reason, setReason] = useState("");
  const [videoUrl, setVideoUrl] = useState(data.videoUrl ?? "");
  const router = useRouter();
  const [recovery, setRecovery] = useState<"unknown" | "refresh_pending" | null>(null);
  const run = (work: () => Promise<{ success: boolean; data?: { refreshPending?: boolean }; error?: { code?: string; message: string } }>, success: string) => startTransition(async () => {
    if (recovery) return;
    try {
      const result = await work();
      if (result.success) {
        if (result.data?.refreshPending) setRecovery("refresh_pending");
        toast.success(success);
      } else {
        if (result.error?.code === "INTERNAL_ERROR") setRecovery("unknown");
        toast.error(result.error?.message ?? "操作失败。");
      }
    } catch { setRecovery("unknown"); }
  });
  const retryRefresh = () => startTransition(async () => {
    try {
      const result = await retryPostMatchRefresh(matchId);
      if (!result.success) { toast.error(result.error.message); return; }
      setRecovery(null);
      router.refresh();
    } catch { toast.error("刷新仍未完成，请稍后重试刷新。"); }
  });

  const frozen = Boolean(data.submittedAt) || (data.canSubmit && !data.rosterReopened);
  const isPostMatch = data.canSubmit;
  return <section className="space-y-3 border-t border-[var(--color-border)] pt-3">
    {recovery && <div role="alert" className="space-y-2 text-sm">
      <p>{recovery === "unknown" ? "操作结果尚未确认，请刷新页面核对当前资料，不要重复提交。" : "操作已提交，页面刷新待完成。"}</p>
      <Button size="sm" variant="outline" disabled={isPending} onClick={recovery === "unknown" ? () => window.location.reload() : retryRefresh}>{recovery === "unknown" ? "刷新页面核对资料" : "重试刷新（不重复提交）"}</Button>
    </div>}
    {isPostMatch && <p className="text-xs text-[var(--color-fg-mid)]">{data.completionLabel}</p>}
    {data.commentators.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">尚无解说</p>}
    <div className="flex flex-wrap gap-2">{data.commentators.map((person) => <span key={person.userId} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs">{person.name}<em className="not-italic text-[var(--color-fg-dim)]">{person.hasLiveStream ? "有直播间" : "无直播间"}</em>{!frozen && <button type="button" aria-label={`移除 ${person.name}`} className="ml-1 text-[var(--color-danger)]" onClick={() => run(() => removeMatchCommentator({ matchId, userId: person.userId }), "已移除解说。")} disabled={isPending || Boolean(recovery)}>×</button>}</span>)}</div>
    {!frozen && data.commentators.length < 2 && <div className="flex flex-wrap gap-2">{data.seasonAdmins.filter((person) => !data.commentators.some((commentator) => commentator.userId === person.userId)).map((person) => <Button key={person.userId} type="button" size="sm" variant="outline" disabled={isPending || Boolean(recovery)} onClick={() => run(() => addMatchCommentator({ matchId, userId: person.userId }), "已登记实际解说。")}>添加 {person.name}（{person.hasLiveStream ? "有直播间" : "无直播间"}）</Button>)}</div>}
    {data.canSubmit && <MatchRecordingEditor matchId={matchId} recordings={data.recordings} commentators={data.commentators} />}
    {data.canSubmit && data.videoUrl && <div className="flex flex-wrap gap-2"><Input className="max-w-sm" type="url" aria-label="原有比赛录像链接" placeholder="原有比赛录像链接" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} /><Button type="button" size="sm" variant="outline" disabled={isPending || Boolean(recovery)} onClick={() => run(() => updateMatchVideoUrl({ matchId, videoUrl }), "录像链接已保存。")}>保存录像</Button></div>}
    {data.canSubmit && (frozen ? <Button type="button" size="sm" variant="outline" disabled={isPending || Boolean(recovery)} onClick={() => setConfirmRevoke(true)}>更正解说名单</Button> : data.commentators.length > 0 && <Button type="button" size="sm" disabled={isPending || Boolean(recovery) || !data.canConfirm} onClick={() => run(() => submitPostMatchReport({ matchId }), "解说名单更正已确认。")}>确认名单更正</Button>)}
    {frozen && confirmRevoke && <div className="space-y-2">
      <label className="block space-y-1 text-sm">更正原因（选填）<Textarea maxLength={500} value={reason} disabled={isPending || Boolean(recovery)} onChange={(event) => setReason(event.target.value)} /></label>
      {isPending ? <p role="status" className="text-sm">正在重开名单…</p> : <InlineConfirm
        title="重开解说名单？"
        sub="解说名单将开放更正，本场暂不计入有效解说场次。比分、Demo、统计和录像均保留。"
        confirmLabel="重开名单"
        onCancel={() => { setConfirmRevoke(false); setReason(""); }}
        onConfirm={() => run(async () => {
          const result = await revokePostMatchSubmission({ matchId, reason });
          if (result.success) { setConfirmRevoke(false); setReason(""); }
          return result;
        }, "名单已开放更正。")}
      />}
    </div>}
  </section>;
}
