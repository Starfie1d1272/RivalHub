"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addMatchCommentator, removeMatchCommentator, revokePostMatchSubmission, submitPostMatchReport, updateMatchVideoUrl } from "@/actions/postmatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminPostMatchRecordData } from "@/lib/admin/matches/types";

export type PostMatchRecordData = AdminPostMatchRecordData;
export function PostMatchRecordPanel({ matchId, data }: { matchId: string; data: PostMatchRecordData }) {
  const [isPending, startTransition] = useTransition();
  const [videoUrl, setVideoUrl] = useState(data.videoUrl ?? "");
  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, success: string) => startTransition(async () => { const result = await work(); if (result.success) toast.success(success); else toast.error(result.error?.message ?? "操作失败。"); });
  const frozen = Boolean(data.submittedAt);
  const isPostMatch = data.canSubmit;
  return <section className="space-y-3 border-t border-[var(--color-border)] pt-3">
    <div className="flex items-center justify-between gap-2"><div><p className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">{isPostMatch ? "解说与赛后资料" : "解说与直播配置"}</p><p className="text-xs text-[var(--color-fg-mid)]">{isPostMatch ? `当前状态：${data.completionLabel}。提交后名单冻结；录像可由赛事管理员后补。` : "待开赛和进行中的比赛可提前登记或调整实际解说，并查看其直播间资料。"}</p></div>{isPostMatch && <span className="text-xs font-medium text-[var(--color-fg-mid)]">{data.completionLabel}</span>}</div>
    <div className="flex flex-wrap gap-2">{data.commentators.map((person) => <span key={person.userId} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs">{person.name}<em className="not-italic text-[var(--color-fg-dim)]">{person.hasLiveStream ? "已设置直播间" : "未设置直播间"}</em>{!frozen && <button type="button" className="ml-1 text-[var(--color-danger)]" onClick={() => run(() => removeMatchCommentator({ matchId, userId: person.userId }), "已移除解说。")} disabled={isPending}>×</button>}</span>)}</div>
    {!frozen && data.commentators.length < 2 && <div className="flex flex-wrap gap-2">{data.seasonAdmins.filter((person) => !data.commentators.some((commentator) => commentator.userId === person.userId)).map((person) => <Button key={person.userId} type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => addMatchCommentator({ matchId, userId: person.userId }), "已登记实际解说。")}>添加 {person.name}（{person.hasLiveStream ? "已设置直播间" : "未设置直播间"}）</Button>)}</div>}
    {data.canSubmit && <div className="flex flex-wrap gap-2"><Input className="max-w-sm" type="url" placeholder="比赛录像链接（可在提交后补充）" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} /><Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => updateMatchVideoUrl({ matchId, videoUrl }), "录像链接已保存。")}>保存录像</Button></div>}
    {data.canSubmit && (frozen ? <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => run(() => revokePostMatchSubmission({ matchId }), "已撤销提交，可以重新编辑解说名单。")}>撤销提交 / 重新编辑</Button> : <Button type="button" size="sm" disabled={isPending || data.commentators.length === 0} onClick={() => run(() => submitPostMatchReport({ matchId }), "赛后资料已提交。")}>提交赛后资料</Button>)}
  </section>;
}
