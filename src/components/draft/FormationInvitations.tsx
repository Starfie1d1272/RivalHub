"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmCompetitionEntryParticipation, declineCompetitionEntryParticipation, withdrawCompetitionEntryParticipation, transferCompetitionEntryRepresentative } from "@/actions/competition-entries";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FormationInvitations({ invitations, activeEntry, representativeEntries }: { invitations: { id: string; name: string; position: string | null; canRespond: boolean }[]; activeEntry: { id: string; name: string; representative: boolean; canWithdraw: boolean; canRelease: boolean } | null; representativeEntries: { id: string; name: string; canTransfer: boolean; canRelease: boolean; candidates: { id: string; name: string }[] }[] }) {
  const [pending, startTransition] = useTransition();
  const [withdrawing, setWithdrawing] = useState(false);
  const [successors, setSuccessors] = useState<Record<string, string>>({});
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
      {!activeEntry.canWithdraw && <p className="text-sm">当前不能自行退出，请联系赛事管理员。</p>}
      {activeEntry.canWithdraw && (withdrawing ? <InlineConfirm danger title={activeEntry.canRelease ? "结束代表原队的参赛确认？" : "退出本届赛事？"} sub={activeEntry.canRelease ? "结束后可处理新队邀请。" : "退出后需要重新邀请并确认才能参赛。"} confirmLabel={activeEntry.canRelease ? "确认结束" : "确认退出"} onCancel={() => setWithdrawing(false)} onConfirm={() => { setWithdrawing(false); run(() => withdrawCompetitionEntryParticipation({ entryId: activeEntry.id }), "已退出本届赛事"); }} /> : <Button variant="outline" disabled={pending || (activeEntry.representative && !activeEntry.canRelease)} onClick={() => setWithdrawing(true)}>{activeEntry.canRelease ? "结束原队参赛确认" : "退出本届赛事"}</Button>)}
    </div>}
    {representativeEntries.map(entry => <div key={entry.id} className="space-y-3"><p>我负责的队伍：{entry.name}</p>
      {entry.canTransfer && entry.candidates.length > 0 && <div className="space-y-2"><p className="text-sm">可将赛事负责人交接给已确认成员。</p><div className="flex flex-wrap gap-2"><Select value={successors[entry.id] ?? ""} onValueChange={value => setSuccessors(current => ({ ...current, [entry.id]: value }))}><SelectTrigger aria-label={`${entry.name}的新赛事负责人`} className="w-48"><SelectValue placeholder="选择新负责人" /></SelectTrigger><SelectContent>{entry.candidates.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={pending || !entry.candidates.some(candidate => candidate.id === successors[entry.id])} onClick={() => run(() => transferCompetitionEntryRepresentative({ entryId: entry.id, toUserId: successors[entry.id]! }), "已交接赛事负责人")}>交接负责人</Button></div></div>}
      {!entry.canRelease && entry.candidates.length === 0 && <p className="text-sm">暂无可交接的已确认成员，请联系管理员处理编队。</p>}
    </div>)}
    {invitations.length === 0 ? <p>暂无待确认的编队邀请。</p> : <><p>确认后，你将代表所选队伍参加本届赛事。</p>{invitations.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3"><span>{entry.name} · 本届位置：{entry.position ?? "未填写"}</span><div className="flex gap-2"><Button type="button" disabled={pending || !entry.canRespond || Boolean(activeEntry && activeEntry.id !== entry.id)} onClick={() => run(() => confirmCompetitionEntryParticipation({ entryId: entry.id, expectedPosition: entry.position }), "已确认本届参赛队伍")}>确认参赛</Button><Button type="button" variant="outline" disabled={pending || !entry.canRespond} onClick={() => run(() => declineCompetitionEntryParticipation({ entryId: entry.id }), "已拒绝邀请")}>拒绝邀请</Button></div></div>)}</>}
  </div>;
}
