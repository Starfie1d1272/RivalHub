"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmCompetitionEntryParticipation, declineCompetitionEntryParticipation, withdrawCompetitionEntryParticipation, transferCompetitionEntryRepresentative } from "@/actions/competition-entries";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FormationInvitations({ invitations, activeEntry }: { invitations: { id: string; name: string; position: string | null; canRespond: boolean }[]; activeEntry: { id: string; name: string; representative: boolean; canWithdraw: boolean; canRelease: boolean; canTransfer: boolean; candidates: { id: string; name: string }[] } | null }) {
  const [pending, startTransition] = useTransition();
  const [withdrawing, setWithdrawing] = useState(false);
  const [successor, setSuccessor] = useState("");
  const router = useRouter();
  function run(action: () => Promise<{ success: true } | { success: false; error: { message: string } }>, message: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success(message);
      router.refresh();
    });
  }
  return <div className="space-y-4">
    {activeEntry && <div className="space-y-3"><p>已确认代表：{activeEntry.name}</p>
      {activeEntry.representative && activeEntry.canTransfer && activeEntry.candidates.length > 0 && <div className="space-y-2"><p className="text-sm">退出前请先交接赛事负责人。</p><div className="flex flex-wrap gap-2"><Select value={successor} onValueChange={setSuccessor}><SelectTrigger aria-label="新赛事负责人" className="w-48"><SelectValue placeholder="选择新负责人" /></SelectTrigger><SelectContent>{activeEntry.candidates.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={pending || !successor} onClick={() => run(() => transferCompetitionEntryRepresentative({ entryId: activeEntry.id, toUserId: successor }), "已交接赛事负责人")}>交接负责人</Button></div></div>}
      {activeEntry.representative && activeEntry.candidates.length === 0 && <p className="text-sm">暂无可交接的已确认成员，请联系管理员处理编队。</p>}
      {!activeEntry.canWithdraw && <p className="text-sm">当前不能自行退出，请联系赛事管理员。</p>}
      {activeEntry.canWithdraw && (withdrawing ? <InlineConfirm danger title="退出本届赛事？" sub="退出后需要重新邀请并确认才能参赛。" confirmLabel="确认退出" onCancel={() => setWithdrawing(false)} onConfirm={() => { setWithdrawing(false); run(() => withdrawCompetitionEntryParticipation({ entryId: activeEntry.id }), "已退出本届赛事"); }} /> : <Button variant="outline" disabled={pending || (activeEntry.representative && !activeEntry.canRelease)} onClick={() => setWithdrawing(true)}>退出本届赛事</Button>)}
    </div>}
    {invitations.length === 0 ? <p>暂无待确认的编队邀请。</p> : <><p>确认后，你将代表所选队伍参加本届赛事。</p>{invitations.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3"><span>{entry.name} · 本届位置：{entry.position ?? "未填写"}</span><div className="flex gap-2"><Button type="button" disabled={pending || !entry.canRespond || Boolean(activeEntry && activeEntry.id !== entry.id)} onClick={() => run(() => confirmCompetitionEntryParticipation({ entryId: entry.id, expectedPosition: entry.position }), "已确认本届参赛队伍")}>确认参赛</Button><Button type="button" variant="outline" disabled={pending || !entry.canRespond} onClick={() => run(() => declineCompetitionEntryParticipation({ entryId: entry.id }), "已拒绝邀请")}>拒绝邀请</Button></div></div>)}</>}
  </div>;
}
