"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmCompetitionEntryParticipation } from "@/actions/competition-entries";
import { Button } from "@/components/ui/button";

export function FormationInvitations({ invitations, activeEntry }: { invitations: { id: string; name: string; position: string | null }[]; activeEntry: { id: string; name: string } | null }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function confirm(entryId: string, expectedPosition: string | null) {
    startTransition(async () => {
      const result = await confirmCompetitionEntryParticipation({ entryId, expectedPosition });
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success("已确认本届参赛队伍");
      router.refresh();
    });
  }
  return <div className="space-y-4">{activeEntry && <p>已确认代表：{activeEntry.name}</p>}{invitations.length === 0 ? <p>暂无待确认的编队邀请。</p> : <><p>确认后，你将代表所选队伍参加本届赛事。</p>{invitations.map(entry => <div key={entry.id} className="flex items-center justify-between gap-4"><span>{entry.name} · 本届位置：{entry.position ?? "未填写"}</span><Button type="button" disabled={pending || Boolean(activeEntry && activeEntry.id !== entry.id)} onClick={() => confirm(entry.id, entry.position)}>确认参赛</Button></div>)}</>}{activeEntry && invitations.some(entry => entry.id !== activeEntry.id) && <p className="text-sm">你已确认其他队伍，请联系管理员处理变更。</p>}</div>;
}
