"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addMatchCommentator,
  confirmPostMatchReport,
  removeMatchCommentator,
  returnPostMatchReport,
  settleCommentator,
  submitPostMatchReport,
  updateMatchVideoUrl,
} from "@/actions/postmatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Panel, StatusBanner } from "@/components/rivalhub";

export interface PostMatchOperationsData {
  seasonId: string;
  currentUserId: string;
  feeCents: number;
  admins: Array<{ id: string; name: string }>;
  matches: Array<{
    id: string;
    label: string;
    videoUrl: string | null;
    commentators: Array<{ userId: string; name: string; confirmedFeeCents: number | null; settledAt: Date | null }>;
    report: { status: "draft" | "submitted" | "returned" | "confirmed"; submittedByUserId: string | null; returnReason: string | null } | null;
  }>;
  settlements: Array<{ userId: string; name: string; confirmedMatches: number; pendingMatches: number; payableCents: number; settledCents: number }>;
}

const STATUS: Record<string, string> = { draft: "待填写", submitted: "已提交", returned: "已退回", confirmed: "已确认" };
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export function PostMatchOperations({ data }: { data: PostMatchOperationsData }) {
  const [isPending, startTransition] = useTransition();
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  const [videos, setVideos] = useState<Record<string, string>>(() => Object.fromEntries(data.matches.map((match) => [match.id, match.videoUrl ?? ""])));
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, success: string) => startTransition(async () => {
    const result = await work();
    if (result.success) toast.success(success);
    else toast.error(result.error?.message ?? "操作失败。 ");
  });

  return <div className="space-y-6">
    <Panel label="结算基准" pad={16}>
      <p className="text-sm text-[var(--color-fg-mid)]">当前单场基础费用：<strong className="text-[var(--color-fg)]">{yuan(data.feeCents)} / 人 / 场</strong>。费用在赛后资料确认时快照；之后调整不会影响已确认场次。</p>
    </Panel>

    <section className="space-y-3">
      <h2 className="text-lg font-semibold">赛后记录与实际解说</h2>
      {data.matches.length === 0 ? <StatusBanner tone="info" title="尚无已结束比赛" sub="比赛结束后，可在这里登记解说、录像、提交和确认赛后资料。" /> : data.matches.map((match) => {
        const reporterIsCurrentUser = match.commentators.some((item) => item.userId === data.currentUserId);
        const canConfirm = match.report?.status === "submitted" && match.report.submittedByUserId !== data.currentUserId;
        return <Panel key={match.id} label={match.label} pad={16} className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>赛后状态：<strong>{STATUS[match.report?.status ?? "draft"]}</strong></span>
            {match.report?.returnReason && <span className="text-[var(--color-warn)]">退回原因：{match.report.returnReason}</span>}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">实际解说</p>
            {match.commentators.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未登记。</p> : <div className="flex flex-wrap gap-2">{match.commentators.map((item) => <span key={item.userId} className="inline-flex items-center gap-1 border border-[var(--color-border)] px-2 py-1 text-sm">{item.name}{item.confirmedFeeCents != null && <span className="text-[var(--color-fg-mid)]">· {yuan(item.confirmedFeeCents)}</span>}{match.report?.status !== "confirmed" && <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => removeMatchCommentator({ matchId: match.id, userId: item.userId }), "已移除解说。")}>移除</Button>}</span>)}</div>}
            {match.report?.status !== "confirmed" && <div className="flex gap-2 max-w-md"><Select value={addValues[match.id] ?? ""} onValueChange={(value) => setAddValues((current) => ({ ...current, [match.id]: value }))}><SelectTrigger><SelectValue placeholder="选择本届赛事管理员" /></SelectTrigger><SelectContent>{data.admins.filter((admin) => !match.commentators.some((item) => item.userId === admin.id)).map((admin) => <SelectItem value={admin.id} key={admin.id}>{admin.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!addValues[match.id] || isPending} onClick={() => run(() => addMatchCommentator({ matchId: match.id, userId: addValues[match.id] }), "已登记解说。")}>登记</Button></div>}
          </div>
          <div className="flex flex-wrap gap-2 items-center"><Input className="max-w-xl" type="url" placeholder="B站录像或回放链接（选填）" value={videos[match.id] ?? ""} onChange={(event) => setVideos((current) => ({ ...current, [match.id]: event.target.value }))} /><Button variant="outline" disabled={isPending} onClick={() => run(() => updateMatchVideoUrl({ matchId: match.id, videoUrl: videos[match.id]?.trim() || null }), "录像链接已保存。")}>保存录像</Button></div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
            {reporterIsCurrentUser && match.report?.status !== "confirmed" && <Button disabled={isPending} onClick={() => run(() => submitPostMatchReport({ matchId: match.id }), "赛后资料已提交，等待其他赛事管理员确认。")}>提交赛后资料</Button>}
            {canConfirm && <Button disabled={isPending} onClick={() => run(() => confirmPostMatchReport({ matchId: match.id }), "赛后资料已确认，并已计入解说场次。")}>确认赛后资料</Button>}
            {canConfirm && <div className="flex flex-1 gap-2"><Textarea className="min-h-9" placeholder="退回原因" value={returnReasons[match.id] ?? ""} onChange={(event) => setReturnReasons((current) => ({ ...current, [match.id]: event.target.value }))} /><Button variant="outline" disabled={!returnReasons[match.id]?.trim() || isPending} onClick={() => run(() => returnPostMatchReport({ matchId: match.id, reason: returnReasons[match.id] }), "赛后资料已退回。")}>退回修改</Button></div>}
          </div>
        </Panel>;
      })}
    </section>

    <section className="space-y-3">
      <h2 className="text-lg font-semibold">解说费用结算</h2>
      <Panel pad={0} className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-[var(--color-fg-mid)]"><tr className="border-b border-[var(--color-border)]"><th className="p-3">解说</th><th className="p-3">已确认场次</th><th className="p-3">待结算</th><th className="p-3">应付</th><th className="p-3">已结算</th><th className="p-3" /></tr></thead><tbody>{data.settlements.map((item) => <tr key={item.userId} className="border-b border-[var(--color-border)] last:border-0"><td className="p-3">{item.name}</td><td className="p-3">{item.confirmedMatches}</td><td className="p-3">{item.pendingMatches}</td><td className="p-3">{yuan(item.payableCents)}</td><td className="p-3">{yuan(item.settledCents)}</td><td className="p-3">{item.pendingMatches > 0 && <Button size="sm" disabled={isPending} onClick={() => run(() => settleCommentator({ seasonId: data.seasonId, userId: item.userId }), "待结算场次已标记为已结算。")}>标记已结算</Button>}</td></tr>)}</tbody></table></Panel>
    </section>
  </div>;
}
